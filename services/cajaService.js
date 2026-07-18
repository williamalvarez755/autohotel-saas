// ============================================================
// Servicio de control de caja y gastos operativos.
//
// Quien abre el turno (dueño o trabajador) declara el fondo
// inicial ("sencillo"). Durante el turno ambos roles pueden
// RETIRAR efectivo (gasto operativo o retiro del dueño) con monto
// y justificación obligatorios; cada retiro guarda una NOTA
// autogenerada con formato estricto:
//   "DD-MM-YYYY se retira [monto] para [justificación]"
// Al cerrar se declara el efectivo físico y el sistema calcula:
//   esperado = monto_inicial + ventas en efectivo − retiros/gastos
//   descuadre = declarado − esperado
// Opcionalmente el cierre registra el retiro del efectivo final
// con la nota "DD-MM-YYYY se retira efectivo del hotel" (no entra
// en la fórmula: ocurre después del arqueo).
//
// Multi-tenant: cada consulta filtra por hotel_id. Solo puede haber
// UNA caja abierta por hotel (garantizado por el índice UNIQUE de la
// columna hotel_abierta y revalidado en transacción).
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const { ESTADOS_CAJA } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, aEpoch } = require('../utils/fechas');
const { redondear, sumar } = require('../utils/dinero');

/**
 * Nota autogenerada de un retiro. Formato ESTRICTO pedido por el
 * negocio: "DD-MM-YYYY se retira [monto] para [justificación]".
 * El monto va sin símbolo: entero si no tiene centavos (100),
 * con dos decimales si los tiene (100.50).
 */
function generarNota(fecha, monto, justificacion) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-');
  const n = redondear(monto);
  const montoTexto = Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${d}-${m}-${a} se retira ${montoTexto} para ${justificacion}`;
}

/** Nota del retiro final al cerrar el turno. */
function generarNotaCierre(fecha) {
  const [a, m, d] = String(fecha).slice(0, 10).split('-');
  return `${d}-${m}-${a} se retira efectivo del hotel`;
}

/**
 * Devuelve el id de la caja abierta del hotel dentro de una
 * conexión/transacción (o null si no hay ninguna). Usado también
 * por estanciasService para enlazar cada cobro a su turno.
 */
async function turnoAbiertoId(cx, hotelId) {
  const [filas] = await cx.query(
    `SELECT id FROM turnos_caja WHERE hotel_id = ? AND estado = 'abierta' LIMIT 1`,
    [hotelId]
  );
  return filas.length ? filas[0].id : null;
}

/** Suma del efectivo cobrado y enlazado a un turno. */
async function efectivoDelTurno(cx, turnoId) {
  const [filas] = await cx.query(
    `SELECT COALESCE(SUM(monto_total), 0) AS suma
       FROM cobros WHERE turno_id = ? AND metodo = 'efectivo'`,
    [turnoId]
  );
  return redondear(filas[0].suma);
}

/** Suma de retiros/gastos del turno (los de cierre no cuentan). */
async function retirosDelTurno(cx, turnoId) {
  const [filas] = await cx.query(
    `SELECT COALESCE(SUM(monto), 0) AS suma
       FROM retiros_caja WHERE turno_id = ? AND tipo = 'gasto'`,
    [turnoId]
  );
  return redondear(filas[0].suma);
}

/** Retiros de un turno con quién los hizo (notas incluidas). */
async function listarRetiros(cx, turnoId) {
  const [filas] = await cx.query(
    `SELECT r.id, r.tipo, r.monto, r.justificacion, r.nota, r.fecha,
            u.nombre AS usuario_nombre
       FROM retiros_caja r
       JOIN usuarios u ON u.id = r.usuario_id
      WHERE r.turno_id = ?
      ORDER BY r.fecha DESC, r.id DESC`,
    [turnoId]
  );
  return filas;
}

/**
 * Estado de la caja del hotel: la caja abierta (con su efectivo
 * esperado calculado en vivo) o null si no hay ninguna abierta.
 */
async function estado(hotelId) {
  const [filas] = await pool.query(
    `SELECT t.id, t.usuario_id, t.monto_inicial, t.fecha_apertura,
            u.nombre AS usuario_nombre
       FROM turnos_caja t
       JOIN usuarios u ON u.id = t.usuario_id
      WHERE t.hotel_id = ? AND t.estado = 'abierta'
      LIMIT 1`,
    [hotelId]
  );
  if (!filas.length) return { abierta: null };

  const caja = filas[0];
  const efectivoCobrado = await efectivoDelTurno(pool, caja.id);
  const totalRetiros = await retirosDelTurno(pool, caja.id);
  const retiros = await listarRetiros(pool, caja.id);
  return {
    abierta: {
      id: caja.id,
      usuario_id: caja.usuario_id,
      usuario_nombre: caja.usuario_nombre,
      monto_inicial: redondear(caja.monto_inicial),
      fecha_apertura: caja.fecha_apertura,
      apertura_epoch: aEpoch(caja.fecha_apertura),
      efectivo_cobrado: efectivoCobrado,
      total_retiros: totalRetiros,
      // esperado = inicial + ventas en efectivo − retiros/gastos
      efectivo_esperado: redondear(sumar(caja.monto_inicial, efectivoCobrado) - totalRetiros),
      retiros
    }
  };
}

/**
 * Retiro de efectivo de la caja abierta (gasto operativo o retiro
 * del dueño). Ambos roles pueden hacerlo; exige monto (> 0, sin
 * exceder el efectivo disponible) y justificación. Genera y guarda
 * la nota automática con la fecha exacta del movimiento.
 */
async function retirar(hotelId, usuario, monto, justificacion) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      `SELECT * FROM turnos_caja WHERE hotel_id = ? AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
      [hotelId]
    );
    if (!filas.length) {
      throw new ErrorNegocio('No hay una caja abierta: abra la caja antes de retirar efectivo', 409);
    }
    const caja = filas[0];

    const efectivoCobrado = await efectivoDelTurno(cx, caja.id);
    const totalRetiros = await retirosDelTurno(cx, caja.id);
    const disponible = redondear(sumar(caja.monto_inicial, efectivoCobrado) - totalRetiros);
    if (monto > disponible) {
      throw new ErrorNegocio(
        `No se puede retirar Q ${monto.toFixed(2)}: la caja solo tiene Q ${disponible.toFixed(2)} en efectivo`
      );
    }

    const fecha = ahoraGT();
    const nota = generarNota(fecha, monto, justificacion);
    const [resultado] = await cx.query(
      `INSERT INTO retiros_caja (hotel_id, turno_id, usuario_id, tipo, monto, justificacion, nota, fecha)
       VALUES (?, ?, ?, 'gasto', ?, ?, ?, ?)`,
      [hotelId, caja.id, usuario.id, monto, justificacion, nota, fecha]
    );

    return {
      id: resultado.insertId,
      turno_id: caja.id,
      monto: redondear(monto),
      justificacion,
      nota,
      fecha,
      efectivo_esperado: redondear(disponible - monto)
    };
  });
}

/**
 * Abre una caja para el hotel. Falla si ya hay una abierta (una por
 * hotel). La columna hotel_abierta = hotel_id activa el índice UNIQUE.
 */
async function abrir(hotelId, usuarioId, montoInicial) {
  return conTransaccion(async (cx) => {
    const yaAbierta = await turnoAbiertoId(cx, hotelId);
    if (yaAbierta) {
      throw new ErrorNegocio('Ya hay una caja abierta en este hotel. Ciérrela antes de abrir otra.');
    }
    const ahora = ahoraGT();
    const [resultado] = await cx.query(
      `INSERT INTO turnos_caja
         (hotel_id, usuario_id, monto_inicial, fecha_apertura, estado, hotel_abierta)
       VALUES (?, ?, ?, ?, 'abierta', ?)`,
      [hotelId, usuarioId, montoInicial, ahora, hotelId]
    );
    return {
      id: resultado.insertId,
      monto_inicial: redondear(montoInicial),
      fecha_apertura: ahora
    };
  });
}

/**
 * Cierra la caja abierta del hotel (dueño o trabajador). Fórmula:
 *   monto_sistema = monto_inicial + ventas en efectivo − retiros/gastos
 *   descuadre     = monto_declarado − monto_sistema
 * Si retirarEfectivo = true, registra además el retiro del efectivo
 * declarado con la nota "DD-MM-YYYY se retira efectivo del hotel"
 * (posterior al arqueo: no altera la fórmula).
 */
async function cerrar(hotelId, usuarioId, montoDeclarado, retirarEfectivo = false) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      `SELECT * FROM turnos_caja WHERE hotel_id = ? AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
      [hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('No hay ninguna caja abierta en este hotel', 404);
    const caja = filas[0];

    const efectivoCobrado = await efectivoDelTurno(cx, caja.id);
    const totalRetiros = await retirosDelTurno(cx, caja.id);
    const montoSistema = redondear(sumar(caja.monto_inicial, efectivoCobrado) - totalRetiros);
    const declarado = redondear(montoDeclarado);
    const descuadre = redondear(declarado - montoSistema);
    const ahora = ahoraGT();

    await cx.query(
      `UPDATE turnos_caja
          SET estado = 'cerrada', fecha_cierre = ?, monto_sistema = ?,
              monto_declarado = ?, descuadre = ?, cerrado_por = ?, hotel_abierta = NULL
        WHERE id = ?`,
      [ahora, montoSistema, declarado, descuadre, usuarioId, caja.id]
    );

    let notaCierre = null;
    if (retirarEfectivo && declarado > 0) {
      notaCierre = generarNotaCierre(ahora);
      await cx.query(
        `INSERT INTO retiros_caja (hotel_id, turno_id, usuario_id, tipo, monto, justificacion, nota, fecha)
         VALUES (?, ?, ?, 'cierre', ?, 'cierre de caja', ?, ?)`,
        [hotelId, caja.id, usuarioId, declarado, notaCierre, ahora]
      );
    }

    return {
      id: caja.id,
      monto_inicial: redondear(caja.monto_inicial),
      efectivo_cobrado: efectivoCobrado,
      total_retiros: totalRetiros,
      monto_sistema: montoSistema,
      monto_declarado: declarado,
      descuadre,
      nota_cierre: notaCierre,
      fecha_cierre: ahora
    };
  });
}

/** Historial de cajas del hotel (para auditoría del dueño). */
async function historial(hotelId, limite = 100) {
  const [filas] = await pool.query(
    `SELECT t.id, t.monto_inicial, t.fecha_apertura, t.fecha_cierre,
            t.monto_sistema, t.monto_declarado, t.descuadre, t.estado,
            u.nombre AS usuario_nombre, c.nombre AS cerrado_por_nombre,
            (SELECT COALESCE(SUM(r.monto), 0) FROM retiros_caja r
              WHERE r.turno_id = t.id AND r.tipo = 'gasto') AS total_retiros,
            (SELECT COUNT(*) FROM retiros_caja r WHERE r.turno_id = t.id) AS notas
       FROM turnos_caja t
       JOIN usuarios u ON u.id = t.usuario_id
       LEFT JOIN usuarios c ON c.id = t.cerrado_por
      WHERE t.hotel_id = ?
      ORDER BY t.fecha_apertura DESC, t.id DESC
      LIMIT ?`,
    [hotelId, limite]
  );
  // Para las cajas aún abiertas, calcula el esperado en vivo.
  for (const caja of filas) {
    if (caja.estado === ESTADOS_CAJA.ABIERTA) {
      const efectivo = await efectivoDelTurno(pool, caja.id);
      caja.monto_sistema = redondear(sumar(caja.monto_inicial, efectivo) - Number(caja.total_retiros));
    }
  }
  return filas;
}

/** Retiros de la caja abierta del hotel (pantalla operativa). */
async function retirosCajaAbierta(hotelId) {
  const turnoId = await turnoAbiertoId(pool, hotelId);
  if (!turnoId) return { turno_id: null, retiros: [] };
  return { turno_id: turnoId, retiros: await listarRetiros(pool, turnoId) };
}

/** Notas/retiros de un turno del hotel (auditoría del dueño). */
async function notasDeTurno(hotelId, turnoId) {
  const [turnos] = await pool.query(
    `SELECT id FROM turnos_caja WHERE id = ? AND hotel_id = ? LIMIT 1`,
    [turnoId, hotelId]
  );
  if (!turnos.length) throw new ErrorNegocio('Turno de caja no encontrado', 404);
  return listarRetiros(pool, turnoId);
}

module.exports = {
  turnoAbiertoId, estado, abrir, retirar, cerrar,
  historial, retirosCajaAbierta, notasDeTurno
};
