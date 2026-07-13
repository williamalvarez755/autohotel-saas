// ============================================================
// Servicio de reservas. Crear una reserva pasa la habitación a
// RESERVADA; cancelarla la devuelve a DISPONIBLE. La conversión
// en entrada la realiza estanciasService (reserva_id en la
// entrada), que marca la reserva como usada.
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const { ESTADOS_HABITACION, ESTADOS_RESERVA } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, aEpoch } = require('../utils/fechas');

/** Reservas pendientes del hotel + últimas resueltas (contexto). */
async function listar(hotelId) {
  const [pendientes] = await pool.query(
    `SELECT r.id, r.fecha_hora, r.placa, r.nota, r.estado, r.creado_en,
            h.id AS habitacion_id, h.nombre AS habitacion_nombre,
            u.nombre AS creado_por_nombre
       FROM reservas r
       JOIN habitaciones h ON h.id = r.habitacion_id
       JOIN usuarios u ON u.id = r.creado_por
      WHERE r.hotel_id = ? AND r.estado = 'pendiente'
      ORDER BY r.fecha_hora`,
    [hotelId]
  );
  const [historial] = await pool.query(
    `SELECT r.id, r.fecha_hora, r.placa, r.nota, r.estado,
            h.nombre AS habitacion_nombre
       FROM reservas r
       JOIN habitaciones h ON h.id = r.habitacion_id
      WHERE r.hotel_id = ? AND r.estado <> 'pendiente'
      ORDER BY r.id DESC
      LIMIT 20`,
    [hotelId]
  );
  return {
    pendientes: pendientes.map((r) => ({ ...r, fecha_hora_epoch: aEpoch(r.fecha_hora) })),
    historial
  };
}

/** Crea una reserva sobre una habitación disponible. */
async function crear(hotelId, usuarioId, datos) {
  return conTransaccion(async (cx) => {
    const [habitaciones] = await cx.query(
      'SELECT id, nombre, estado FROM habitaciones WHERE id = ? AND hotel_id = ? AND activo = 1 LIMIT 1 FOR UPDATE',
      [datos.habitacion_id, hotelId]
    );
    if (!habitaciones.length) throw new ErrorNegocio('Habitación no encontrada', 404);
    const habitacion = habitaciones[0];

    if (habitacion.estado !== ESTADOS_HABITACION.DISPONIBLE) {
      throw new ErrorNegocio(`Solo se pueden reservar habitaciones disponibles (estado actual: ${habitacion.estado})`);
    }

    const ahora = ahoraGT();
    if (datos.fecha_hora < ahora) {
      throw new ErrorNegocio('La fecha y hora de la reserva debe ser futura');
    }

    const [resultado] = await cx.query(
      `INSERT INTO reservas (hotel_id, habitacion_id, fecha_hora, placa, nota, estado, creado_por, creado_en)
       VALUES (?, ?, ?, ?, ?, 'pendiente', ?, ?)`,
      [hotelId, habitacion.id, datos.fecha_hora, datos.placa, datos.nota, usuarioId, ahora]
    );

    await cx.query(
      `UPDATE habitaciones SET estado = 'reservada' WHERE id = ?`,
      [habitacion.id]
    );

    return { id: resultado.insertId, habitacion_nombre: habitacion.nombre };
  });
}

/** Cancela una reserva pendiente y libera la habitación. */
async function cancelar(hotelId, reservaId) {
  return conTransaccion(async (cx) => {
    const [reservas] = await cx.query(
      `SELECT id, habitacion_id FROM reservas
        WHERE id = ? AND hotel_id = ? AND estado = 'pendiente'
        LIMIT 1 FOR UPDATE`,
      [reservaId, hotelId]
    );
    if (!reservas.length) throw new ErrorNegocio('Reserva no encontrada o ya resuelta', 404);
    const reserva = reservas[0];

    await cx.query('UPDATE reservas SET estado = ? WHERE id = ?', [ESTADOS_RESERVA.CANCELADA, reserva.id]);

    // Libera la habitación solo si sigue marcada como reservada.
    await cx.query(
      `UPDATE habitaciones SET estado = 'disponible'
        WHERE id = ? AND hotel_id = ? AND estado = 'reservada'`,
      [reserva.habitacion_id, hotelId]
    );
    return { id: reserva.id };
  });
}

module.exports = { listar, crear, cancelar };
