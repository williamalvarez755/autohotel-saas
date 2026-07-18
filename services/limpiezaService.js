// ============================================================
// Limpieza de datos históricos + políticas de retención.
//
// El superadmin elige una fecha límite y qué tipos de información
// purgar. Flujo seguro: resumen (conteos) → respaldo (descarga de
// los registros) → doble confirmación (texto ELIMINAR) → borrado
// en transacción → auditoría con usuario/fecha/cantidades.
//
// Las políticas de retención definen cuántos meses conservar cada
// tipo y permiten programar la limpieza (mensual/trimestral/anual);
// el ciclo programado corre dentro del servidor y guarda un
// respaldo JSON en la carpeta respaldos/ antes de borrar.
// ============================================================

const fs = require('fs');
const path = require('path');
const { pool, conTransaccion } = require('../db/pool');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, hoyGT } = require('../utils/fechas');
const auditoriaService = require('./auditoriaService');

const LIMITE_RESPALDO = 5000; // filas por tipo en el respaldo descargable
const CARPETA_RESPALDOS = path.join(__dirname, '..', 'respaldos');

// Catálogo de tipos purgables, mapeado a las tablas REALES del
// sistema. "Facturas/consumos" viven en cobros y pedidos, que se
// eliminan junto con su estancia para no dejar contabilidad coja.
const TIPOS = {
  estancias: {
    etiqueta: 'Estancias finalizadas (con sus pedidos y cobros)',
    mesesDefecto: 24,
    conteo: async (cx, fecha) => {
      const [[e]] = await cx.query(
        `SELECT COUNT(*) AS n FROM estancias WHERE estado = 'finalizada' AND hora_entrada < ?`, [fecha]);
      return e.n;
    },
    respaldo: async (cx, fecha) => {
      const [filas] = await cx.query(
        `SELECT * FROM estancias WHERE estado = 'finalizada' AND hora_entrada < ?
          ORDER BY id LIMIT ${LIMITE_RESPALDO}`, [fecha]);
      return filas;
    },
    eliminar: async (cx, fecha) => {
      await cx.query(
        `DELETE p FROM pedidos p
           JOIN estancias e ON e.id = p.estancia_id
          WHERE e.estado = 'finalizada' AND e.hora_entrada < ?`, [fecha]);
      await cx.query(
        `DELETE c FROM cobros c
           JOIN estancias e ON e.id = c.estancia_id
          WHERE e.estado = 'finalizada' AND e.hora_entrada < ?`, [fecha]);
      const [r] = await cx.query(
        `DELETE FROM estancias WHERE estado = 'finalizada' AND hora_entrada < ?`, [fecha]);
      return r.affectedRows;
    }
  },
  reservas: {
    etiqueta: 'Reservas resueltas (usadas o canceladas)',
    mesesDefecto: 12,
    conteo: async (cx, fecha) => {
      const [[r]] = await cx.query(
        `SELECT COUNT(*) AS n FROM reservas WHERE estado <> 'pendiente' AND fecha_hora < ?`, [fecha]);
      return r.n;
    },
    respaldo: async (cx, fecha) => {
      const [filas] = await cx.query(
        `SELECT * FROM reservas WHERE estado <> 'pendiente' AND fecha_hora < ?
          ORDER BY id LIMIT ${LIMITE_RESPALDO}`, [fecha]);
      return filas;
    },
    eliminar: async (cx, fecha) => {
      const [r] = await cx.query(
        `DELETE FROM reservas WHERE estado <> 'pendiente' AND fecha_hora < ?`, [fecha]);
      return r.affectedRows;
    }
  },
  movimientos: {
    etiqueta: 'Movimientos de inventario',
    mesesDefecto: 12,
    conteo: async (cx, fecha) => {
      const [[m]] = await cx.query(
        `SELECT COUNT(*) AS n FROM movimientos_inventario WHERE fecha < ?`, [fecha]);
      return m.n;
    },
    respaldo: async (cx, fecha) => {
      const [filas] = await cx.query(
        `SELECT * FROM movimientos_inventario WHERE fecha < ? ORDER BY id LIMIT ${LIMITE_RESPALDO}`, [fecha]);
      return filas;
    },
    eliminar: async (cx, fecha) => {
      const [r] = await cx.query(`DELETE FROM movimientos_inventario WHERE fecha < ?`, [fecha]);
      return r.affectedRows;
    }
  },
  turnos_caja: {
    etiqueta: 'Turnos de caja cerrados',
    mesesDefecto: 24,
    conteo: async (cx, fecha) => {
      const [[t]] = await cx.query(
        `SELECT COUNT(*) AS n FROM turnos_caja WHERE estado = 'cerrada' AND fecha_apertura < ?`, [fecha]);
      return t.n;
    },
    respaldo: async (cx, fecha) => {
      const [filas] = await cx.query(
        `SELECT * FROM turnos_caja WHERE estado = 'cerrada' AND fecha_apertura < ?
          ORDER BY id LIMIT ${LIMITE_RESPALDO}`, [fecha]);
      return filas;
    },
    // cobros.turno_id tiene ON DELETE SET NULL: los cobros que aún
    // existan quedan sin turno pero con su contabilidad intacta.
    eliminar: async (cx, fecha) => {
      const [r] = await cx.query(
        `DELETE FROM turnos_caja WHERE estado = 'cerrada' AND fecha_apertura < ?`, [fecha]);
      return r.affectedRows;
    }
  },
  auditoria: {
    etiqueta: 'Registros de auditoría',
    mesesDefecto: 120,
    conteo: async (cx, fecha) => {
      const [[a]] = await cx.query(`SELECT COUNT(*) AS n FROM auditoria WHERE fecha < ?`, [fecha]);
      return a.n;
    },
    respaldo: async (cx, fecha) => {
      const [filas] = await cx.query(
        `SELECT * FROM auditoria WHERE fecha < ? ORDER BY id LIMIT ${LIMITE_RESPALDO}`, [fecha]);
      return filas;
    },
    eliminar: async (cx, fecha) => {
      const [r] = await cx.query(`DELETE FROM auditoria WHERE fecha < ?`, [fecha]);
      return r.affectedRows;
    }
  },
  sesiones: {
    etiqueta: 'Sesiones expiradas',
    mesesDefecto: 1,
    conteo: async (cx) => {
      const [[s]] = await cx.query(
        `SELECT COUNT(*) AS n FROM sesiones WHERE expires < UNIX_TIMESTAMP()`);
      return s.n;
    },
    respaldo: async () => [], // una sesión expirada no tiene valor de respaldo
    eliminar: async (cx) => {
      const [r] = await cx.query(`DELETE FROM sesiones WHERE expires < UNIX_TIMESTAMP()`);
      return r.affectedRows;
    }
  }
};

const TIPOS_VALIDOS = Object.keys(TIPOS);

function validarTipos(tipos) {
  if (!Array.isArray(tipos) || !tipos.length) {
    throw new ErrorNegocio('Debe indicar al menos un tipo de información a limpiar');
  }
  const invalidos = tipos.filter((t) => !TIPOS_VALIDOS.includes(t));
  if (invalidos.length) {
    throw new ErrorNegocio(`Tipos inválidos: ${invalidos.join(', ')}. Válidos: ${TIPOS_VALIDOS.join(', ')}`);
  }
  return [...new Set(tipos)];
}

/** Resumen: cuántos registros de cada tipo caerían antes de la fecha. */
async function resumen(fecha) {
  const resultado = [];
  for (const tipo of TIPOS_VALIDOS) {
    resultado.push({
      tipo,
      etiqueta: TIPOS[tipo].etiqueta,
      registros: await TIPOS[tipo].conteo(pool, fecha)
    });
  }
  return { fecha_limite: fecha, tipos: resultado };
}

/** Respaldo descargable (JSON) de los registros que serían eliminados. */
async function respaldo(fecha, tipos) {
  const seleccion = validarTipos(tipos);
  const datos = { generado: ahoraGT(), fecha_limite: fecha, limite_por_tipo: LIMITE_RESPALDO, tablas: {} };
  for (const tipo of seleccion) {
    datos.tablas[tipo] = await TIPOS[tipo].respaldo(pool, fecha);
  }
  return datos;
}

/**
 * Ejecuta la limpieza en transacción. Exige la confirmación textual
 * "ELIMINAR" (la doble confirmación vive en el frontend + aquí).
 */
async function ejecutar(usuario, req, fecha, tipos, confirmacion) {
  if (confirmacion !== 'ELIMINAR') {
    throw new ErrorNegocio('Confirmación incorrecta: escriba ELIMINAR para ejecutar la limpieza');
  }
  const seleccion = validarTipos(tipos);

  const resultado = await conTransaccion(async (cx) => {
    const detalle = [];
    let total = 0;
    for (const tipo of seleccion) {
      const eliminados = await TIPOS[tipo].eliminar(cx, fecha);
      detalle.push({ tipo, etiqueta: TIPOS[tipo].etiqueta, eliminados });
      total += eliminados;
    }
    return { fecha_limite: fecha, total_eliminados: total, detalle };
  });

  await pool.query(
    `UPDATE politicas_retencion SET ultima_ejecucion = ? WHERE tipo IN (?)`,
    [ahoraGT(), seleccion]
  );
  await auditoriaService.registrar(usuario, req, 'limpieza.ejecutar',
    `Antes de ${fecha}: ${resultado.detalle.map((d) => `${d.tipo}=${d.eliminados}`).join(', ')} (total ${resultado.total_eliminados})`);

  return resultado;
}

// ============================================================
// Políticas de retención
// ============================================================

/** Garantiza que existan las políticas por defecto (instalaciones viejas). */
async function asegurarPoliticas() {
  for (const tipo of TIPOS_VALIDOS) {
    await pool.query(
      `INSERT IGNORE INTO politicas_retencion (tipo, meses, programada) VALUES (?, ?, 'manual')`,
      [tipo, TIPOS[tipo].mesesDefecto]
    );
  }
}

async function listarPoliticas() {
  await asegurarPoliticas();
  const [filas] = await pool.query(`SELECT * FROM politicas_retencion ORDER BY tipo`);
  return filas.map((p) => ({ ...p, etiqueta: TIPOS[p.tipo] ? TIPOS[p.tipo].etiqueta : p.tipo }));
}

async function actualizarPolitica(usuario, req, tipo, meses, programada) {
  if (!TIPOS_VALIDOS.includes(tipo)) throw new ErrorNegocio('Tipo de política desconocido', 404);
  await asegurarPoliticas();
  await pool.query(
    `UPDATE politicas_retencion SET meses = ?, programada = ? WHERE tipo = ?`,
    [meses, programada, tipo]
  );
  await auditoriaService.registrar(usuario, req, 'retencion.actualizar',
    `${tipo}: conservar ${meses} mes(es), limpieza ${programada}`);
  return { tipo, meses, programada };
}

/** 'YYYY-MM-DD 00:00:00' de hoy menos N meses (hora GT). */
function fechaLimitePorMeses(meses) {
  const [a, m, d] = hoyGT().split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1 - meses, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')} 00:00:00`;
}

const DIAS_POR_FRECUENCIA = { mensual: 30, trimestral: 91, anual: 365 };

/**
 * Ciclo programado (lo invoca el servidor periódicamente): ejecuta
 * las políticas no manuales que ya cumplieron su frecuencia.
 * Guarda un respaldo JSON en respaldos/ antes de borrar y audita
 * como acción del sistema.
 */
async function cicloProgramado() {
  const politicas = await listarPoliticas();
  const ahora = Date.now();

  for (const p of politicas) {
    if (p.programada === 'manual') continue;
    const dias = DIAS_POR_FRECUENCIA[p.programada];
    const ultima = p.ultima_ejecucion ? Date.parse(String(p.ultima_ejecucion).replace(' ', 'T')) : 0;
    if (ahora - ultima < dias * 86400000) continue;

    const fecha = fechaLimitePorMeses(p.meses);
    const registros = await TIPOS[p.tipo].conteo(pool, fecha);
    if (!registros) {
      await pool.query(`UPDATE politicas_retencion SET ultima_ejecucion = ? WHERE tipo = ?`, [ahoraGT(), p.tipo]);
      continue;
    }

    // Respaldo local antes de borrar
    try {
      fs.mkdirSync(CARPETA_RESPALDOS, { recursive: true });
      const archivo = path.join(CARPETA_RESPALDOS, `respaldo-${p.tipo}-${hoyGT()}.json`);
      fs.writeFileSync(archivo, JSON.stringify(await respaldo(fecha, [p.tipo]), null, 2));
    } catch (error) {
      console.error(`Limpieza programada: no se pudo respaldar ${p.tipo}:`, error.message);
      continue; // sin respaldo no se borra
    }

    await ejecutar(null, null, fecha, [p.tipo], 'ELIMINAR');
    console.log(`Limpieza programada de "${p.tipo}" ejecutada (${registros} registros antes de ${fecha}).`);
  }
}

module.exports = {
  resumen,
  respaldo,
  ejecutar,
  listarPoliticas,
  actualizarPolitica,
  cicloProgramado,
  fechaLimitePorMeses,
  TIPOS_VALIDOS
};
