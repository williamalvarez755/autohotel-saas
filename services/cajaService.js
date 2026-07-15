// ============================================================
// Servicio de control de caja (turnos de efectivo físico).
//
// Un trabajador abre su caja con un fondo inicial ("sencillo"),
// opera durante su turno y al cerrar declara el efectivo contado.
// El sistema calcula el efectivo ESPERADO (fondo + cobros en
// efectivo enlazados al turno) y el DESCUADRE (declarado - sistema:
// positivo = sobrante, negativo = faltante).
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
  return {
    abierta: {
      id: caja.id,
      usuario_id: caja.usuario_id,
      usuario_nombre: caja.usuario_nombre,
      monto_inicial: redondear(caja.monto_inicial),
      fecha_apertura: caja.fecha_apertura,
      apertura_epoch: aEpoch(caja.fecha_apertura),
      efectivo_cobrado: efectivoCobrado,
      efectivo_esperado: sumar(caja.monto_inicial, efectivoCobrado)
    }
  };
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
 * Cierra la caja abierta del hotel. Calcula el efectivo esperado
 * (fondo + cobros en efectivo del turno) y el descuadre frente a lo
 * declarado. Deja la caja como 'cerrada' y libera el índice de
 * apertura (hotel_abierta = NULL).
 */
async function cerrar(hotelId, usuarioId, montoDeclarado) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      `SELECT * FROM turnos_caja WHERE hotel_id = ? AND estado = 'abierta' LIMIT 1 FOR UPDATE`,
      [hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('No hay ninguna caja abierta en este hotel', 404);
    const caja = filas[0];

    const efectivoCobrado = await efectivoDelTurno(cx, caja.id);
    const montoSistema = sumar(caja.monto_inicial, efectivoCobrado);
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

    return {
      id: caja.id,
      monto_inicial: redondear(caja.monto_inicial),
      efectivo_cobrado: efectivoCobrado,
      monto_sistema: montoSistema,
      monto_declarado: declarado,
      descuadre,
      fecha_cierre: ahora
    };
  });
}

/** Historial de cajas del hotel (para auditoría del dueño). */
async function historial(hotelId, limite = 100) {
  const [filas] = await pool.query(
    `SELECT t.id, t.monto_inicial, t.fecha_apertura, t.fecha_cierre,
            t.monto_sistema, t.monto_declarado, t.descuadre, t.estado,
            u.nombre AS usuario_nombre, c.nombre AS cerrado_por_nombre
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
      caja.monto_sistema = sumar(caja.monto_inicial, efectivo);
    }
  }
  return filas;
}

module.exports = { turnoAbiertoId, estado, abrir, cerrar, historial };
