// ============================================================
// Controlador de inventario. Aplica las reglas por rol:
// - Trabajador: crear productos (precio opcional) y registrar
//   entradas de mercadería.
// - Dueño: además editar, ajustar en ambas direcciones y
//   desactivar; y auditar el historial de movimientos.
// ============================================================

const productosService = require('../services/productosService');
const { ok } = require('../utils/respuesta');
const { ROLES, LIMITES } = require('../config/constantes');
const v = require('../utils/validacion');

async function listar(req, res) {
  const incluirInactivos = req.usuario.rol === ROLES.DUENO && req.query.todos === '1';
  const datos = await productosService.listar(req.hotelId, incluirInactivos);
  return ok(res, datos);
}

async function crear(req, res) {
  const cuerpo = req.body || {};
  const esDueno = req.usuario.rol === ROLES.DUENO;
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    // El trabajador puede indicar el precio al dar de alta la
    // mercadería (o dejarlo en 0 para que el dueño lo confirme).
    precio: cuerpo.precio === undefined || cuerpo.precio === '' || cuerpo.precio === null
      ? 0
      : v.montoNoNegativo(cuerpo.precio, 'precio', LIMITES.MAX_MONTO),
    stock: v.enteroNoNegativo(cuerpo.stock, 'stock inicial', 1000000),
    stock_minimo: cuerpo.stock_minimo === undefined || cuerpo.stock_minimo === '' || cuerpo.stock_minimo === null
      ? 0
      : v.enteroNoNegativo(cuerpo.stock_minimo, 'stock mínimo', 1000000)
  };
  const resultado = await productosService.crear(req.hotelId, req.usuario, datos);
  const mensaje = esDueno || datos.precio > 0
    ? 'Producto creado'
    : 'Producto creado con precio Q 0.00: el dueño debe confirmar el precio';
  return ok(res, resultado, mensaje);
}

async function editar(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    precio: v.montoNoNegativo(cuerpo.precio, 'precio', LIMITES.MAX_MONTO),
    stock_minimo: v.enteroNoNegativo(cuerpo.stock_minimo, 'stock mínimo', 1000000),
    activo: v.booleano(cuerpo.activo !== undefined ? cuerpo.activo : true, 'activo')
  };
  const resultado = await productosService.editar(req.hotelId, id, datos);
  return ok(res, resultado, 'Producto actualizado');
}

async function registrarEntrada(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const cantidad = v.enteroPositivo(cuerpo.cantidad, 'cantidad', 1000000);
  const motivo = v.textoOpcional(cuerpo.motivo, 'motivo', 200) || 'Ingreso de mercadería';
  const resultado = await productosService.registrarEntrada(req.hotelId, req.usuario, id, cantidad, motivo);
  return ok(res, resultado, 'Entrada de mercadería registrada');
}

async function ajustarStock(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const direccion = v.opcionValida(cuerpo.direccion, 'dirección del ajuste', ['sumar', 'restar']);
  const cantidad = v.enteroPositivo(cuerpo.cantidad, 'cantidad', 1000000);
  const motivo = v.textoRequerido(cuerpo.motivo, 'motivo', 200);
  const resultado = await productosService.ajustarStock(req.hotelId, req.usuario, id, direccion, cantidad, motivo);
  return ok(res, resultado, 'Stock ajustado');
}

async function movimientos(req, res) {
  const productoId = req.query.producto_id ? v.idValido(req.query.producto_id, 'producto_id') : null;
  const datos = await productosService.movimientos(req.hotelId, productoId);
  return ok(res, datos);
}

module.exports = { listar, crear, editar, registrarEntrada, ajustarStock, movimientos };
