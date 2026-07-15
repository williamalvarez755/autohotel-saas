// ============================================================
// Controlador del control de caja (turnos de efectivo).
// ============================================================

const cajaService = require('../services/cajaService');
const { ok } = require('../utils/respuesta');
const { LIMITES } = require('../config/constantes');
const v = require('../utils/validacion');

async function estado(req, res) {
  const datos = await cajaService.estado(req.hotelId);
  return ok(res, datos);
}

async function abrir(req, res) {
  const cuerpo = req.body || {};
  const montoInicial = v.montoNoNegativo(cuerpo.monto_inicial, 'fondo de caja', LIMITES.MAX_MONTO);
  const resultado = await cajaService.abrir(req.hotelId, req.usuario.id, montoInicial);
  return ok(res, resultado, 'Caja abierta');
}

async function cerrar(req, res) {
  const cuerpo = req.body || {};
  const montoDeclarado = v.montoNoNegativo(cuerpo.monto_declarado, 'efectivo declarado', LIMITES.MAX_MONTO);
  const resultado = await cajaService.cerrar(req.hotelId, req.usuario.id, montoDeclarado);
  return ok(res, resultado, 'Caja cerrada');
}

async function historial(req, res) {
  const datos = await cajaService.historial(req.hotelId);
  return ok(res, datos);
}

module.exports = { estado, abrir, cerrar, historial };
