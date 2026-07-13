// ============================================================
// Controlador de pedidos dentro de una estancia.
// ============================================================

const pedidosService = require('../services/pedidosService');
const { ok } = require('../utils/respuesta');
const { LIMITES } = require('../config/constantes');
const v = require('../utils/validacion');

async function crear(req, res) {
  const estanciaId = v.idValido(req.params.id, 'estancia');
  const cuerpo = req.body || {};
  const productoId = v.idValido(cuerpo.producto_id, 'producto_id');
  const cantidad = v.enteroPositivo(cuerpo.cantidad, 'cantidad', LIMITES.MAX_CANTIDAD_PEDIDO);
  const resultado = await pedidosService.crear(req.hotelId, req.usuario.id, estanciaId, productoId, cantidad);
  return ok(res, resultado, 'Pedido agregado');
}

async function listar(req, res) {
  const estanciaId = v.idValido(req.params.id, 'estancia');
  const datos = await pedidosService.listarPorEstancia(req.hotelId, estanciaId);
  return ok(res, datos);
}

module.exports = { crear, listar };
