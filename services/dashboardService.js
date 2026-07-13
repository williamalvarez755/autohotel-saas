// ============================================================
// Servicio del dashboard del dueño: ingresos reales del día
// (tomados del libro de cobros), clientes del día, ocupación
// actual y resumen de alertas del hotel seleccionado.
// ============================================================

const { pool } = require('../db/pool');
const alertasService = require('./alertasService');
const { hoyGT, sumarHoras } = require('../utils/fechas');

async function resumen(hotel) {
  const inicioDia = hoyGT() + ' 00:00:00';
  const finDia = sumarHoras(inicioDia, 24);

  const [ingresos] = await pool.query(
    `SELECT COALESCE(SUM(monto_total), 0) AS total,
            COALESCE(SUM(monto_habitacion), 0) AS habitaciones,
            COALESCE(SUM(monto_pedidos), 0) AS pedidos,
            COUNT(*) AS cobros
       FROM cobros
      WHERE hotel_id = ? AND fecha >= ? AND fecha < ?`,
    [hotel.id, inicioDia, finDia]
  );

  const [clientes] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM estancias
      WHERE hotel_id = ? AND hora_entrada >= ? AND hora_entrada < ?`,
    [hotel.id, inicioDia, finDia]
  );

  const [ocupacion] = await pool.query(
    `SELECT estado, COUNT(*) AS cantidad
       FROM habitaciones
      WHERE hotel_id = ? AND activo = 1
      GROUP BY estado`,
    [hotel.id]
  );

  const estados = { disponible: 0, ocupada: 0, limpieza: 0, reservada: 0 };
  for (const fila of ocupacion) estados[fila.estado] = fila.cantidad;

  const alertas = await alertasService.obtener(hotel);

  return {
    fecha: hoyGT(),
    ingresos_dia: ingresos[0],
    clientes_dia: clientes[0].total,
    habitaciones: estados,
    alertas
  };
}

module.exports = { resumen };
