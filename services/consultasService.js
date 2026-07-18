// ============================================================
// Consultas Avanzadas del superadmin: catálogo de consultas
// PREDEFINIDAS y parametrizadas sobre todos los hoteles, para
// responder solicitudes de clientes sin tocar la base a mano.
//
// Seguridad: el cliente elige un tipo del catálogo y filtros
// simples (fechas, hotel, texto, estado); el SQL es fijo y 100%
// parametrizado — jamás se ejecuta SQL del cliente.
//
// Nota de dominio: este sistema no guarda identidad de huéspedes
// (privacidad del autohotel); el "cliente" se identifica por la
// PLACA del vehículo, por eso las búsquedas de cliente son por
// placa sobre estancias y reservas.
// ============================================================

const { pool } = require('../db/pool');
const { ErrorNegocio } = require('../middleware/errores');

const LIMITE = 1000;

/** Rango [desde 00:00, hasta+1día) para columnas DATETIME. */
function rangoFechas(filtros) {
  const desde = filtros.desde ? `${filtros.desde} 00:00:00` : '1970-01-01 00:00:00';
  const hasta = filtros.hasta ? `${filtros.hasta} 23:59:59` : '2999-12-31 23:59:59';
  return { desde, hasta };
}

/** Filtro opcional por hotel: devuelve { sql, params }. */
function filtroHotel(filtros, columna) {
  if (!filtros.hotel_id) return { sql: '', params: [] };
  return { sql: ` AND ${columna} = ?`, params: [filtros.hotel_id] };
}

// Cada consulta del catálogo recibe los filtros validados y
// devuelve { sql, params }. El SELECT define las columnas que
// verá el superadmin (el frontend las rotula solo).
const CATALOGO = {
  // ---------- Clientes (por placa) ----------
  clientes: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'e.hotel_id');
    const placa = f.busqueda ? ` AND e.placa LIKE ?` : '';
    return {
      sql: `SELECT ht.nombre AS hotel, hb.nombre AS habitacion, e.placa,
                   e.tipo, e.tarifa_nombre AS tarifa, e.hora_entrada, e.hora_salida_real,
                   e.total_final, e.estado
              FROM estancias e
              JOIN hoteles ht ON ht.id = e.hotel_id
              JOIN habitaciones hb ON hb.id = e.habitacion_id
             WHERE e.hora_entrada BETWEEN ? AND ?${h.sql}${placa}
             ORDER BY e.hora_entrada DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params, ...(f.busqueda ? [`%${f.busqueda}%`] : [])]
    };
  },

  // ---------- Reservas ----------
  reservas: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'r.hotel_id');
    const estado = f.estado && f.estado !== 'todas' ? ` AND r.estado = ?` : '';
    const placa = f.busqueda ? ` AND (r.placa LIKE ? OR hb.nombre LIKE ?)` : '';
    return {
      sql: `SELECT ht.nombre AS hotel, hb.nombre AS habitacion, r.fecha_hora,
                   r.placa, r.nota, r.cargo_extra, r.estado, u.nombre AS creada_por, r.creado_en
              FROM reservas r
              JOIN hoteles ht ON ht.id = r.hotel_id
              JOIN habitaciones hb ON hb.id = r.habitacion_id
              JOIN usuarios u ON u.id = r.creado_por
             WHERE r.fecha_hora BETWEEN ? AND ?${h.sql}${estado}${placa}
             ORDER BY r.fecha_hora DESC LIMIT ${LIMITE}`,
      params: [
        desde, hasta, ...h.params,
        ...(estado ? [f.estado] : []),
        ...(f.busqueda ? [`%${f.busqueda}%`, `%${f.busqueda}%`] : [])
      ]
    };
  },

  // ---------- Ventas (libro de cobros) ----------
  ventas_dia: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'c.hotel_id');
    return {
      sql: `SELECT DATE(c.fecha) AS dia, ht.nombre AS hotel,
                   COUNT(*) AS cobros, SUM(c.monto_total) AS total,
                   SUM(CASE WHEN c.metodo = 'efectivo' THEN c.monto_total ELSE 0 END) AS efectivo,
                   SUM(CASE WHEN c.metodo = 'transferencia' THEN c.monto_total ELSE 0 END) AS transferencia
              FROM cobros c JOIN hoteles ht ON ht.id = c.hotel_id
             WHERE c.fecha BETWEEN ? AND ?${h.sql}
             GROUP BY DATE(c.fecha), c.hotel_id ORDER BY dia DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params]
    };
  },
  ventas_mes: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'c.hotel_id');
    return {
      sql: `SELECT DATE_FORMAT(c.fecha, '%Y-%m') AS mes, ht.nombre AS hotel,
                   COUNT(*) AS cobros, SUM(c.monto_total) AS total
              FROM cobros c JOIN hoteles ht ON ht.id = c.hotel_id
             WHERE c.fecha BETWEEN ? AND ?${h.sql}
             GROUP BY DATE_FORMAT(c.fecha, '%Y-%m'), c.hotel_id ORDER BY mes DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params]
    };
  },
  ventas_anio: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'c.hotel_id');
    return {
      sql: `SELECT YEAR(c.fecha) AS anio, ht.nombre AS hotel,
                   COUNT(*) AS cobros, SUM(c.monto_total) AS total
              FROM cobros c JOIN hoteles ht ON ht.id = c.hotel_id
             WHERE c.fecha BETWEEN ? AND ?${h.sql}
             GROUP BY YEAR(c.fecha), c.hotel_id ORDER BY anio DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params]
    };
  },
  ventas_metodo: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'c.hotel_id');
    return {
      sql: `SELECT ht.nombre AS hotel, c.metodo,
                   COUNT(*) AS cobros, SUM(c.monto_total) AS total
              FROM cobros c JOIN hoteles ht ON ht.id = c.hotel_id
             WHERE c.fecha BETWEEN ? AND ?${h.sql}
             GROUP BY c.hotel_id, c.metodo ORDER BY hotel, c.metodo LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params]
    };
  },

  // ---------- Habitaciones ----------
  habitaciones: (f) => {
    const h = filtroHotel(f, 'hb.hotel_id');
    const estado = f.estado && f.estado !== 'todas' ? ` AND hb.estado = ?` : '';
    return {
      sql: `SELECT ht.nombre AS hotel, hb.nombre AS habitacion, hb.estado,
                   hb.precio_noche, hb.precio_hora_extra,
                   CASE WHEN hb.activo = 1 THEN 'sí' ELSE 'no' END AS activa
              FROM habitaciones hb JOIN hoteles ht ON ht.id = hb.hotel_id
             WHERE 1 = 1${h.sql}${estado}
             ORDER BY ht.nombre, hb.nombre LIMIT ${LIMITE}`,
      params: [...h.params, ...(estado ? [f.estado] : [])]
    };
  },

  // ---------- Inventario ----------
  inventario_bajo: (f) => {
    const h = filtroHotel(f, 'p.hotel_id');
    return {
      sql: `SELECT ht.nombre AS hotel, p.nombre AS producto, p.stock,
                   p.stock_minimo, p.precio
              FROM productos p JOIN hoteles ht ON ht.id = p.hotel_id
             WHERE p.activo = 1 AND p.stock <= p.stock_minimo${h.sql}
             ORDER BY (p.stock - p.stock_minimo) LIMIT ${LIMITE}`,
      params: [...h.params]
    };
  },
  inventario_top: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const h = filtroHotel(f, 'pe.hotel_id');
    return {
      sql: `SELECT ht.nombre AS hotel, pr.nombre AS producto,
                   SUM(pe.cantidad) AS unidades, SUM(pe.subtotal) AS total_vendido
              FROM pedidos pe
              JOIN productos pr ON pr.id = pe.producto_id
              JOIN hoteles ht ON ht.id = pe.hotel_id
             WHERE pe.fecha BETWEEN ? AND ?${h.sql}
             GROUP BY pe.hotel_id, pe.producto_id
             ORDER BY unidades DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...h.params]
    };
  },
  inventario_sin_movimiento: (f) => {
    const { desde } = rangoFechas(f);
    const h = filtroHotel(f, 'p.hotel_id');
    return {
      sql: `SELECT ht.nombre AS hotel, p.nombre AS producto, p.stock, p.precio,
                   (SELECT MAX(pe.fecha) FROM pedidos pe WHERE pe.producto_id = p.id) AS ultima_venta
              FROM productos p JOIN hoteles ht ON ht.id = p.hotel_id
             WHERE p.activo = 1${h.sql}
               AND NOT EXISTS (SELECT 1 FROM pedidos pe WHERE pe.producto_id = p.id AND pe.fecha >= ?)
             ORDER BY ht.nombre, p.nombre LIMIT ${LIMITE}`,
      params: [...h.params, desde]
    };
  },

  // ---------- Usuarios ----------
  usuarios: (f) => {
    const h = filtroHotel(f, 'u.hotel_id');
    const estado = f.estado === 'activos' ? ' AND u.activo = 1'
      : f.estado === 'inactivos' ? ' AND u.activo = 0' : '';
    const texto = f.busqueda ? ` AND (u.nombre LIKE ? OR u.usuario LIKE ?)` : '';
    return {
      sql: `SELECT u.nombre, u.usuario, u.rol,
                   COALESCE(ht.nombre, '—') AS hotel,
                   CASE WHEN u.activo = 1 THEN 'activo' ELSE 'inactivo' END AS estado,
                   u.ultimo_acceso, u.creado_en
              FROM usuarios u LEFT JOIN hoteles ht ON ht.id = u.hotel_id
             WHERE u.rol <> 'superadmin'${h.sql}${estado}${texto}
             ORDER BY u.ultimo_acceso IS NULL, u.ultimo_acceso DESC LIMIT ${LIMITE}`,
      params: [...h.params, ...(f.busqueda ? [`%${f.busqueda}%`, `%${f.busqueda}%`] : [])]
    };
  },

  // ---------- Auditoría ----------
  auditoria: (f) => {
    const { desde, hasta } = rangoFechas(f);
    const texto = f.busqueda ? ` AND (a.accion LIKE ? OR a.detalle LIKE ? OR a.usuario_nombre LIKE ?)` : '';
    return {
      sql: `SELECT a.fecha, a.usuario_nombre AS usuario, a.accion, a.detalle, a.ip
              FROM auditoria a
             WHERE a.fecha BETWEEN ? AND ?${texto}
             ORDER BY a.fecha DESC, a.id DESC LIMIT ${LIMITE}`,
      params: [desde, hasta, ...(f.busqueda ? Array(3).fill(`%${f.busqueda}%`) : [])]
    };
  }
};

const TIPOS = Object.keys(CATALOGO);

/** Ejecuta una consulta del catálogo con filtros ya validados. */
async function ejecutar(tipo, filtros) {
  const consulta = CATALOGO[tipo];
  if (!consulta) {
    throw new ErrorNegocio(`Consulta desconocida. Disponibles: ${TIPOS.join(', ')}`);
  }
  const { sql, params } = consulta(filtros);
  const [filas] = await pool.query(sql, params);
  return { tipo, total: filas.length, limite: LIMITE, filas };
}

/** Hoteles (id + nombre) para el filtro del frontend. */
async function hotelesParaFiltro() {
  const [filas] = await pool.query(
    `SELECT h.id, h.nombre, u.nombre AS dueno
       FROM hoteles h JOIN usuarios u ON u.id = h.dueno_id
      ORDER BY h.nombre`
  );
  return filas;
}

module.exports = { ejecutar, hotelesParaFiltro, TIPOS };
