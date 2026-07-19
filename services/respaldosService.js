// ============================================================
// Respaldo completo y restauración de la base de datos
// (solo superadmin).
//
// - Exportar: todas las tablas de negocio a un JSON con versión,
//   fecha y conteos. Las fechas viajan como texto plano (el pool
//   usa dateStrings) → el respaldo es fiel byte a byte.
// - Restaurar: valida la estructura contra un ALLOWLIST de tablas
//   y contra las columnas REALES (information_schema) — los
//   nombres de tabla/columna jamás salen del servidor, así que el
//   contenido del archivo no puede inyectar SQL. Antes de tocar
//   nada se guarda un respaldo automático en respaldos/ ("sin
//   respaldo no se restaura", mismo espíritu que la limpieza).
//   El borrado+inserción corre en UNA transacción con
//   FOREIGN_KEY_CHECKS=0 (hoteles↔usuarios son FKs circulares);
//   la variable SIEMPRE se restaura antes de soltar la conexión.
// - La tabla `sesiones` NO se respalda ni se restaura, pero al
//   restaurar se INVALIDAN todas las sesiones menos la del
//   superadmin actual: una sesión vieja podría apuntar a un id de
//   usuario que ahora es OTRA persona con otros permisos.
// ============================================================

const fs = require('fs');
const path = require('path');
const { pool, conTransaccion } = require('../db/pool');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, hoyGT } = require('../utils/fechas');
const auditoriaService = require('./auditoriaService');

const VERSION_RESPALDO = 1;
const CARPETA_RESPALDOS = path.join(__dirname, '..', 'respaldos');
const MAX_FILAS_POR_TABLA = 500000; // tope de cordura contra archivos absurdos
const LOTE_INSERT = 200;

// Orden lógico padres→hijos (con FK checks apagados el orden no es
// obligatorio, pero mantenerlo hace los respaldos legibles y
// predecibles). `sesiones` queda fuera a propósito.
const TABLAS_RESPALDO = [
  'usuarios', 'hoteles', 'suscripciones', 'pagos_servicio',
  'habitaciones', 'tarifas', 'extras_habitacion', 'productos',
  'turnos_caja', 'estancias', 'pedidos', 'cobros', 'retiros_caja',
  'movimientos_inventario', 'reservas', 'auditoria', 'politicas_retencion'
];

/** Columnas reales de una tabla (de information_schema, nunca del cliente). */
async function columnasDe(cx, tabla) {
  const [cols] = await cx.query(
    `SELECT COLUMN_NAME AS nombre
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ORDINAL_POSITION`,
    [tabla]
  );
  return cols.map((c) => c.nombre);
}

/** Exporta todas las tablas de negocio a un objeto serializable. */
async function exportar() {
  const datos = {
    sistema: 'autohotel-saas',
    version: VERSION_RESPALDO,
    generado: ahoraGT(),
    tablas: {}
  };
  for (const tabla of TABLAS_RESPALDO) {
    // `tabla` viene del allowlist del servidor, no del cliente
    const [filas] = await pool.query(`SELECT * FROM \`${tabla}\``);
    datos.tablas[tabla] = filas;
  }
  return datos;
}

/** Conteo de filas por tabla de un respaldo (para resúmenes). */
function conteos(datos) {
  const resultado = {};
  for (const tabla of TABLAS_RESPALDO) {
    resultado[tabla] = Array.isArray(datos.tablas[tabla]) ? datos.tablas[tabla].length : 0;
  }
  return resultado;
}

/**
 * Valida la estructura de un respaldo subido. Devuelve el detalle
 * de columnas usables por tabla (intersección estricta: una columna
 * desconocida = rechazo, probablemente es de una versión más nueva).
 */
async function validarEstructura(datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
    throw new ErrorNegocio('El archivo no es un respaldo válido');
  }
  if (datos.sistema !== 'autohotel-saas') {
    throw new ErrorNegocio('El archivo no es un respaldo de AutoHotel SaaS');
  }
  if (!Number.isInteger(datos.version) || datos.version < 1 || datos.version > VERSION_RESPALDO) {
    throw new ErrorNegocio(`Versión de respaldo no soportada (esperada 1–${VERSION_RESPALDO})`);
  }
  if (!datos.tablas || typeof datos.tablas !== 'object' || Array.isArray(datos.tablas)) {
    throw new ErrorNegocio('El respaldo no contiene el bloque de tablas');
  }

  const desconocidas = Object.keys(datos.tablas).filter((t) => !TABLAS_RESPALDO.includes(t));
  if (desconocidas.length) {
    throw new ErrorNegocio(`El respaldo contiene tablas desconocidas: ${desconocidas.join(', ')}`);
  }

  const plan = {};
  for (const tabla of TABLAS_RESPALDO) {
    const filas = datos.tablas[tabla];
    if (filas === undefined) { plan[tabla] = { filas: [], columnas: [] }; continue; }
    if (!Array.isArray(filas)) {
      throw new ErrorNegocio(`La tabla "${tabla}" del respaldo no es una lista de filas`);
    }
    if (filas.length > MAX_FILAS_POR_TABLA) {
      throw new ErrorNegocio(`La tabla "${tabla}" excede el máximo de filas permitido`);
    }
    let columnas = [];
    if (filas.length) {
      const primera = filas[0];
      if (!primera || typeof primera !== 'object' || Array.isArray(primera)) {
        throw new ErrorNegocio(`La tabla "${tabla}" contiene filas con formato inválido`);
      }
      const reales = await columnasDe(pool, tabla);
      const delRespaldo = Object.keys(primera);
      const extranas = delRespaldo.filter((c) => !reales.includes(c));
      if (extranas.length) {
        throw new ErrorNegocio(
          `La tabla "${tabla}" tiene columnas desconocidas (${extranas.join(', ')}): ` +
          'el respaldo parece ser de una versión más nueva del sistema'
        );
      }
      // Solo columnas reales y en el orden real; las columnas nuevas
      // que el respaldo viejo no traiga tomarán su DEFAULT.
      columnas = reales.filter((c) => delRespaldo.includes(c));
      for (const fila of filas) {
        if (!fila || typeof fila !== 'object' || Array.isArray(fila)) {
          throw new ErrorNegocio(`La tabla "${tabla}" contiene filas con formato inválido`);
        }
      }
    }
    plan[tabla] = { filas, columnas };
  }

  // Sin un superadmin activo el proveedor quedaría fuera del sistema
  const usuarios = plan.usuarios.filas;
  const haySuperadmin = usuarios.some((u) => u.rol === 'superadmin' && Number(u.activo) === 1);
  if (!haySuperadmin) {
    throw new ErrorNegocio('El respaldo no contiene ningún superadmin activo: restaurarlo dejaría el sistema sin administración');
  }

  return plan;
}

/** Guarda un respaldo automático en respaldos/ antes de restaurar. */
function guardarPreRestauracion(datos) {
  fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
  const marca = ahoraGT().replace(/[: ]/g, '-');
  const nombre = `pre-restauracion-${marca}.json`;
  fs.writeFileSync(path.join(CARPETA_RESPALDOS, nombre), JSON.stringify(datos));
  return nombre;
}

/**
 * Restaura un respaldo completo. Exige la confirmación textual
 * "RESTAURAR". Devuelve conteos por tabla y el nombre del respaldo
 * automático previo.
 */
async function restaurar(usuario, req, datos, confirmacion) {
  if (confirmacion !== 'RESTAURAR') {
    throw new ErrorNegocio('Confirmación incorrecta: escriba RESTAURAR para reemplazar los datos');
  }
  const plan = await validarEstructura(datos);

  // Respaldo automático del estado ACTUAL: sin él no se restaura.
  let archivoPrevio;
  try {
    archivoPrevio = guardarPreRestauracion(await exportar());
  } catch (error) {
    throw new ErrorNegocio('No se pudo guardar el respaldo previo a la restauración: ' + error.message, 500);
  }

  const sesionActual = req && req.sessionID ? req.sessionID : '';

  const resultado = await conTransaccion(async (cx) => {
    await cx.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      const detalle = {};
      for (const tabla of TABLAS_RESPALDO) {
        await cx.query(`DELETE FROM \`${tabla}\``);
        const { filas, columnas } = plan[tabla];
        if (filas.length && columnas.length) {
          const listaColumnas = columnas.map((c) => `\`${c}\``).join(', ');
          for (let i = 0; i < filas.length; i += LOTE_INSERT) {
            const lote = filas.slice(i, i + LOTE_INSERT)
              .map((f) => columnas.map((c) => (f[c] === undefined ? null : f[c])));
            await cx.query(`INSERT INTO \`${tabla}\` (${listaColumnas}) VALUES ?`, [lote]);
          }
        }
        detalle[tabla] = filas.length;
      }
      // Las sesiones viejas podrían apuntar a ids que ahora son OTRO
      // usuario: se invalidan todas menos la del superadmin actual.
      await cx.query('DELETE FROM sesiones WHERE session_id <> ?', [sesionActual]);
      return detalle;
    } finally {
      // Pase lo que pase, la conexión vuelve al pool con los checks activos
      await cx.query('SET FOREIGN_KEY_CHECKS = 1');
    }
  });

  await auditoriaService.registrar(usuario, req, 'respaldo.restaurar',
    `Restauración completa (generado ${datos.generado || 'sin fecha'}); ` +
    `filas: ${Object.entries(resultado).map(([t, n]) => `${t}=${n}`).join(', ')}; ` +
    `respaldo previo: ${archivoPrevio}`);

  return { restaurado: resultado, respaldo_previo: archivoPrevio, generado: datos.generado };
}

// ============================================================
// Respaldos guardados en el servidor (respaldos/)
// ============================================================

const NOMBRE_ARCHIVO_VALIDO = /^[A-Za-z0-9._-]+\.json$/;

/** Lista los .json de la carpeta respaldos/ (nombre, tamaño, fecha GT). */
function listarArchivos() {
  if (!fs.existsSync(CARPETA_RESPALDOS)) return [];
  return fs.readdirSync(CARPETA_RESPALDOS)
    .filter((n) => NOMBRE_ARCHIVO_VALIDO.test(n))
    .map((n) => {
      const info = fs.statSync(path.join(CARPETA_RESPALDOS, n));
      // Fecha en hora GT (GMT-6), como todas las fechas del sistema
      const gt = new Date(info.mtime.getTime() - 6 * 3600000)
        .toISOString().replace('T', ' ').slice(0, 19);
      return { nombre: n, bytes: info.size, modificado: gt };
    })
    .sort((a, b) => b.modificado.localeCompare(a.modificado));
}

/**
 * Ruta absoluta de un respaldo guardado, validando el nombre contra
 * el patrón permitido Y que el resultado quede DENTRO de la carpeta
 * (doble candado anti path-traversal).
 */
function rutaArchivo(nombre) {
  if (typeof nombre !== 'string' || !NOMBRE_ARCHIVO_VALIDO.test(nombre)) {
    throw new ErrorNegocio('Nombre de respaldo inválido', 400);
  }
  const ruta = path.resolve(CARPETA_RESPALDOS, nombre);
  if (!ruta.startsWith(path.resolve(CARPETA_RESPALDOS) + path.sep)) {
    throw new ErrorNegocio('Nombre de respaldo inválido', 400);
  }
  if (!fs.existsSync(ruta)) {
    throw new ErrorNegocio('El respaldo no existe', 404);
  }
  return ruta;
}

module.exports = { exportar, conteos, restaurar, listarArchivos, rutaArchivo, TABLAS_RESPALDO };
