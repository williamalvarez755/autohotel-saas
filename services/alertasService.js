// ============================================================
// Servicio de alertas automáticas por hotel:
//  1. Tiempo excedido: estancias activas pasadas de su hora
//     de salida prevista.
//  2. Habitaciones sin limpiar: más de N minutos en LIMPIEZA
//     (configurable por hotel, por defecto 30).
//  3. Bajo stock: productos activos con stock <= stock mínimo.
// ============================================================

const { pool } = require('../db/pool');
const { ahoraGT, haceMinutos, aEpoch, minutosTranscurridos } = require('../utils/fechas');

async function obtener(hotel) {
  const ahora = ahoraGT();
  const corteLimpieza = haceMinutos(hotel.minutos_alerta_limpieza);

  const [excedidas] = await pool.query(
    `SELECT e.id AS estancia_id, e.placa, e.hora_salida_prevista,
            h.id AS habitacion_id, h.nombre AS habitacion_nombre
       FROM estancias e
       JOIN habitaciones h ON h.id = e.habitacion_id
      WHERE e.hotel_id = ? AND e.estado = 'activa' AND e.hora_salida_prevista < ?
      ORDER BY e.hora_salida_prevista`,
    [hotel.id, ahora]
  );

  const [sinLimpiar] = await pool.query(
    `SELECT id AS habitacion_id, nombre AS habitacion_nombre, limpieza_desde
       FROM habitaciones
      WHERE hotel_id = ? AND activo = 1 AND estado = 'limpieza'
        AND limpieza_desde IS NOT NULL AND limpieza_desde <= ?
      ORDER BY limpieza_desde`,
    [hotel.id, corteLimpieza]
  );

  const [bajoStock] = await pool.query(
    `SELECT id AS producto_id, nombre, stock, stock_minimo
       FROM productos
      WHERE hotel_id = ? AND activo = 1 AND stock <= stock_minimo
      ORDER BY stock`,
    [hotel.id]
  );

  const tiempoExcedido = excedidas.map((e) => ({
    ...e,
    minutos_excedidos: Math.max(0, minutosTranscurridos(e.hora_salida_prevista)),
    salida_prevista_epoch: aEpoch(e.hora_salida_prevista)
  }));

  const limpieza = sinLimpiar.map((h) => ({
    ...h,
    minutos: Math.max(0, minutosTranscurridos(h.limpieza_desde))
  }));

  return {
    tiempo_excedido: tiempoExcedido,
    limpieza_pendiente: limpieza,
    bajo_stock: bajoStock,
    total: tiempoExcedido.length + limpieza.length + bajoStock.length
  };
}

module.exports = { obtener };
