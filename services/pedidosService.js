// ============================================================
// Servicio de pedidos (consumos de una estancia activa).
// El registro de un pedido es transaccional: descuenta stock
// (validando que nunca quede negativo), registra el movimiento
// de inventario y actualiza el total acumulado de la estancia.
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const { TIPOS_MOVIMIENTO } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT } = require('../utils/fechas');
const { multiplicar } = require('../utils/dinero');

/** Registra un pedido dentro de una estancia activa. */
async function crear(hotelId, usuarioId, estanciaId, productoId, cantidad) {
  return conTransaccion(async (cx) => {
    const [estancias] = await cx.query(
      `SELECT e.id, e.total_pedidos, h.nombre AS habitacion_nombre
         FROM estancias e
         JOIN habitaciones h ON h.id = e.habitacion_id
        WHERE e.id = ? AND e.hotel_id = ? AND e.estado = 'activa'
        LIMIT 1 FOR UPDATE`,
      [estanciaId, hotelId]
    );
    if (!estancias.length) throw new ErrorNegocio('Estancia no encontrada o ya finalizada', 404);
    const estancia = estancias[0];

    const [productos] = await cx.query(
      `SELECT id, nombre, precio, stock
         FROM productos
        WHERE id = ? AND hotel_id = ? AND activo = 1
        LIMIT 1 FOR UPDATE`,
      [productoId, hotelId]
    );
    if (!productos.length) throw new ErrorNegocio('Producto no encontrado o desactivado', 404);
    const producto = productos[0];

    if (producto.stock < cantidad) {
      throw new ErrorNegocio(
        `Stock insuficiente de "${producto.nombre}": quedan ${producto.stock} unidades`
      );
    }

    const fecha = ahoraGT();
    const subtotal = multiplicar(producto.precio, cantidad);

    const [resultado] = await cx.query(
      `INSERT INTO pedidos (hotel_id, estancia_id, producto_id, cantidad, precio_unitario, subtotal, fecha, usuario_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [hotelId, estanciaId, productoId, cantidad, producto.precio, subtotal, fecha, usuarioId]
    );

    await cx.query(
      'UPDATE productos SET stock = stock - ? WHERE id = ?',
      [cantidad, productoId]
    );

    await cx.query(
      `INSERT INTO movimientos_inventario (hotel_id, producto_id, tipo, cantidad, motivo, usuario_id, fecha)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        hotelId, productoId, TIPOS_MOVIMIENTO.SALIDA, cantidad,
        `Pedido en ${estancia.habitacion_nombre} (estancia #${estanciaId})`,
        usuarioId, fecha
      ]
    );

    // Total acumulado calculado en SQL para evitar carreras.
    await cx.query(
      `UPDATE estancias
          SET total_pedidos = ROUND(total_pedidos + ?, 2),
              total_final = ROUND(total_habitacion + total_pedidos, 2)
        WHERE id = ?`,
      [subtotal, estanciaId]
    );

    const [totales] = await cx.query(
      'SELECT total_pedidos FROM estancias WHERE id = ?',
      [estanciaId]
    );

    return {
      pedido_id: resultado.insertId,
      producto_nombre: producto.nombre,
      cantidad,
      precio_unitario: producto.precio,
      subtotal,
      stock_restante: producto.stock - cantidad,
      total_pedidos: totales[0].total_pedidos
    };
  });
}

/** Pedidos de una estancia (validando que sea del hotel). */
async function listarPorEstancia(hotelId, estanciaId) {
  const [estancias] = await pool.query(
    'SELECT id, total_pedidos FROM estancias WHERE id = ? AND hotel_id = ? LIMIT 1',
    [estanciaId, hotelId]
  );
  if (!estancias.length) throw new ErrorNegocio('Estancia no encontrada', 404);

  const [pedidos] = await pool.query(
    `SELECT p.id, p.cantidad, p.precio_unitario, p.subtotal, p.fecha,
            pr.nombre AS producto_nombre, u.nombre AS usuario_nombre
       FROM pedidos p
       JOIN productos pr ON pr.id = p.producto_id
       JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.estancia_id = ? AND p.hotel_id = ?
      ORDER BY p.fecha DESC, p.id DESC`,
    [estanciaId, hotelId]
  );
  return { pedidos, total_pedidos: estancias[0].total_pedidos };
}

module.exports = { crear, listarPorEstancia };
