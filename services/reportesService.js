// ============================================================
// Servicio de reportes (solo dueño). Los ingresos salen del
// libro de cobros (dinero realmente cobrado), por lo que los
// reportes siempre cuadran con la operación registrada.
// ============================================================

const { pool } = require('../db/pool');
const { ErrorNegocio } = require('../middleware/errores');
const { esFechaValida, sumarHoras } = require('../utils/fechas');

/** Valida el rango de fechas y devuelve [desde 00:00, hasta+1día). */
function rango(desde, hasta) {
  if (!esFechaValida(desde) || !esFechaValida(hasta)) {
    throw new ErrorNegocio('Las fechas deben tener formato AAAA-MM-DD');
  }
  if (desde > hasta) {
    throw new ErrorNegocio('La fecha inicial no puede ser mayor que la final');
  }
  const inicio = desde + ' 00:00:00';
  const finExclusivo = sumarHoras(hasta + ' 00:00:00', 24);
  const dias = (Date.parse(hasta) - Date.parse(desde)) / 86400000;
  if (dias > 366) {
    throw new ErrorNegocio('El rango máximo es de 366 días');
  }
  return { inicio, finExclusivo };
}

/** Ingresos por día dentro del rango. */
async function ingresosPorDia(hotelId, desde, hasta) {
  const { inicio, finExclusivo } = rango(desde, hasta);
  const [filas] = await pool.query(
    `SELECT DATE(fecha) AS dia,
            COALESCE(SUM(monto_habitacion), 0) AS habitaciones,
            COALESCE(SUM(monto_pedidos), 0) AS pedidos,
            COALESCE(SUM(monto_total), 0) AS total,
            COUNT(*) AS cobros
       FROM cobros
      WHERE hotel_id = ? AND fecha >= ? AND fecha < ?
      GROUP BY DATE(fecha)
      ORDER BY dia`,
    [hotelId, inicio, finExclusivo]
  );
  const totales = filas.reduce(
    (acc, f) => ({
      habitaciones: acc.habitaciones + Number(f.habitaciones),
      pedidos: acc.pedidos + Number(f.pedidos),
      total: acc.total + Number(f.total),
      cobros: acc.cobros + Number(f.cobros)
    }),
    { habitaciones: 0, pedidos: 0, total: 0, cobros: 0 }
  );
  return { dias: filas, totales };
}

/** Ingresos por habitación dentro del rango (filtro opcional). */
async function ingresosPorHabitacion(hotelId, desde, hasta, habitacionId) {
  const { inicio, finExclusivo } = rango(desde, hasta);
  const parametros = [hotelId, inicio, finExclusivo];
  let filtro = '';
  if (habitacionId) {
    filtro = 'AND c.habitacion_id = ?';
    parametros.push(habitacionId);
  }
  const [filas] = await pool.query(
    `SELECT h.id, h.nombre,
            COUNT(DISTINCT c.estancia_id) AS estancias,
            COALESCE(SUM(c.monto_habitacion), 0) AS habitacion,
            COALESCE(SUM(c.monto_pedidos), 0) AS pedidos,
            COALESCE(SUM(c.monto_total), 0) AS total
       FROM cobros c
       JOIN habitaciones h ON h.id = c.habitacion_id
      WHERE c.hotel_id = ? AND c.fecha >= ? AND c.fecha < ? ${filtro}
      GROUP BY h.id, h.nombre
      ORDER BY total DESC`,
    parametros
  );
  return filas;
}

/** Productos más vendidos dentro del rango. */
async function productosMasVendidos(hotelId, desde, hasta) {
  const { inicio, finExclusivo } = rango(desde, hasta);
  const [filas] = await pool.query(
    `SELECT p.id, p.nombre,
            COALESCE(SUM(pe.cantidad), 0) AS unidades,
            COALESCE(SUM(pe.subtotal), 0) AS total
       FROM pedidos pe
       JOIN productos p ON p.id = pe.producto_id
      WHERE pe.hotel_id = ? AND pe.fecha >= ? AND pe.fecha < ?
      GROUP BY p.id, p.nombre
      ORDER BY unidades DESC, total DESC
      LIMIT 30`,
    [hotelId, inicio, finExclusivo]
  );
  return filas;
}

/** Listado de estancias del rango (para cuadre del dueño). */
async function estancias(hotelId, desde, hasta, habitacionId) {
  const { inicio, finExclusivo } = rango(desde, hasta);
  const parametros = [hotelId, inicio, finExclusivo];
  let filtro = '';
  if (habitacionId) {
    filtro = 'AND e.habitacion_id = ?';
    parametros.push(habitacionId);
  }
  const [filas] = await pool.query(
    `SELECT e.id, e.placa, e.tipo, e.horas_contratadas, e.horas_extra,
            e.hora_entrada, e.hora_salida_prevista, e.hora_salida_real,
            e.total_base, e.total_extra, e.total_habitacion,
            e.total_pedidos, e.total_final, e.estado,
            h.nombre AS habitacion_nombre
       FROM estancias e
       JOIN habitaciones h ON h.id = e.habitacion_id
      WHERE e.hotel_id = ? AND e.hora_entrada >= ? AND e.hora_entrada < ? ${filtro}
      ORDER BY e.hora_entrada DESC
      LIMIT 500`,
    parametros
  );
  return filas;
}

module.exports = { ingresosPorDia, ingresosPorHabitacion, productosMasVendidos, estancias };
