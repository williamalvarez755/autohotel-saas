// ============================================================
// Servicio de inventario.
// - Dueño: control total (crear con precio, editar, ajustar
//   stock en ambas direcciones, desactivar).
// - Trabajador: puede dar de alta productos cuando llega
//   mercadería y sumar stock (solo entradas). Cada movimiento
//   queda auditado con usuario, cantidad, motivo y fecha.
// El stock jamás puede quedar negativo (validado en transacción).
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const { TIPOS_MOVIMIENTO, ROLES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT } = require('../utils/fechas');

/** Lista de productos del hotel. El dueño puede incluir inactivos. */
async function listar(hotelId, incluirInactivos) {
  const [filas] = await pool.query(
    `SELECT id, nombre, precio, stock, stock_minimo, activo,
            (stock <= stock_minimo) AS bajo_stock
       FROM productos
      WHERE hotel_id = ? ${incluirInactivos ? '' : 'AND activo = 1'}
      ORDER BY activo DESC, nombre`,
    [hotelId]
  );
  return filas;
}

/**
 * Crea un producto. El trabajador puede indicar el precio de la
 * mercadería recibida (o dejarlo en 0 para que el dueño lo fije),
 * pero no podrá modificarlo después.
 */
async function crear(hotelId, usuario, datos) {
  return conTransaccion(async (cx) => {
    const [existe] = await cx.query(
      'SELECT id FROM productos WHERE hotel_id = ? AND nombre = ? LIMIT 1',
      [hotelId, datos.nombre]
    );
    if (existe.length) {
      throw new ErrorNegocio('Ya existe un producto con ese nombre en este hotel');
    }

    const fecha = ahoraGT();
    const [resultado] = await cx.query(
      `INSERT INTO productos (hotel_id, nombre, precio, stock, stock_minimo, activo, creado_en)
       VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [hotelId, datos.nombre, datos.precio, datos.stock, datos.stock_minimo, fecha]
    );

    if (datos.stock > 0) {
      await cx.query(
        `INSERT INTO movimientos_inventario (hotel_id, producto_id, tipo, cantidad, motivo, usuario_id, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [hotelId, resultado.insertId, TIPOS_MOVIMIENTO.ENTRADA, datos.stock, 'Stock inicial al crear el producto', usuario.id, fecha]
      );
    }
    return { id: resultado.insertId };
  });
}

/** Edición completa (solo dueño): nombre, precio, stock mínimo, activo. */
async function editar(hotelId, productoId, datos) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id FROM productos WHERE id = ? AND hotel_id = ? LIMIT 1 FOR UPDATE',
      [productoId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Producto no encontrado', 404);

    const [duplicado] = await cx.query(
      'SELECT id FROM productos WHERE hotel_id = ? AND nombre = ? AND id <> ? LIMIT 1',
      [hotelId, datos.nombre, productoId]
    );
    if (duplicado.length) {
      throw new ErrorNegocio('Ya existe otro producto con ese nombre en este hotel');
    }

    await cx.query(
      `UPDATE productos SET nombre = ?, precio = ?, stock_minimo = ?, activo = ?
        WHERE id = ? AND hotel_id = ?`,
      [datos.nombre, datos.precio, datos.stock_minimo, datos.activo, productoId, hotelId]
    );
    return { id: productoId };
  });
}

/**
 * Entrada de mercadería (dueño y trabajador): suma stock y deja
 * el movimiento auditado con el usuario que lo registró.
 */
async function registrarEntrada(hotelId, usuario, productoId, cantidad, motivo) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id, nombre, stock FROM productos WHERE id = ? AND hotel_id = ? AND activo = 1 LIMIT 1 FOR UPDATE',
      [productoId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Producto no encontrado o desactivado', 404);

    await cx.query('UPDATE productos SET stock = stock + ? WHERE id = ?', [cantidad, productoId]);
    await cx.query(
      `INSERT INTO movimientos_inventario (hotel_id, producto_id, tipo, cantidad, motivo, usuario_id, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [hotelId, productoId, TIPOS_MOVIMIENTO.ENTRADA, cantidad, motivo || 'Ingreso de mercadería', usuario.id, ahoraGT()]
    );
    return { id: productoId, stock: filas[0].stock + cantidad };
  });
}

/**
 * Ajuste de stock (solo dueño): 'sumar' o 'restar' una cantidad
 * con motivo obligatorio. Nunca permite stock negativo.
 */
async function ajustarStock(hotelId, usuario, productoId, direccion, cantidad, motivo) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id, nombre, stock FROM productos WHERE id = ? AND hotel_id = ? LIMIT 1 FOR UPDATE',
      [productoId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Producto no encontrado', 404);
    const producto = filas[0];

    let nuevoStock;
    let tipo;
    if (direccion === 'sumar') {
      nuevoStock = producto.stock + cantidad;
      tipo = TIPOS_MOVIMIENTO.AJUSTE_POSITIVO;
    } else {
      nuevoStock = producto.stock - cantidad;
      tipo = TIPOS_MOVIMIENTO.AJUSTE_NEGATIVO;
      if (nuevoStock < 0) {
        throw new ErrorNegocio(
          `No se puede restar ${cantidad}: el stock actual de "${producto.nombre}" es ${producto.stock}`
        );
      }
    }

    await cx.query('UPDATE productos SET stock = ? WHERE id = ?', [nuevoStock, productoId]);
    await cx.query(
      `INSERT INTO movimientos_inventario (hotel_id, producto_id, tipo, cantidad, motivo, usuario_id, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [hotelId, productoId, tipo, cantidad, motivo, usuario.id, ahoraGT()]
    );
    return { id: productoId, stock: nuevoStock };
  });
}

/** Historial de movimientos de inventario (auditoría del dueño). */
async function movimientos(hotelId, productoId) {
  const parametros = [hotelId];
  let filtroProducto = '';
  if (productoId) {
    filtroProducto = 'AND m.producto_id = ?';
    parametros.push(productoId);
  }
  const [filas] = await pool.query(
    `SELECT m.id, m.tipo, m.cantidad, m.motivo, m.fecha,
            p.nombre AS producto_nombre, u.nombre AS usuario_nombre, u.rol AS usuario_rol
       FROM movimientos_inventario m
       JOIN productos p ON p.id = m.producto_id
       JOIN usuarios u ON u.id = m.usuario_id
      WHERE m.hotel_id = ? ${filtroProducto}
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT 300`,
    parametros
  );
  return filas;
}

module.exports = { listar, crear, editar, registrarEntrada, ajustarStock, movimientos };
