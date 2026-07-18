// ============================================================
// Controlador del control de caja (turnos de efectivo).
// ============================================================

const cajaService = require('../services/cajaService');
const { ok } = require('../utils/respuesta');
const { LIMITES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
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
  const retirarEfectivo = cuerpo.retirar_efectivo === true || cuerpo.retirar_efectivo === 1;
  const resultado = await cajaService.cerrar(req.hotelId, req.usuario.id, montoDeclarado, retirarEfectivo);
  return ok(res, resultado, 'Caja cerrada');
}

/** Retiro de efectivo (gasto operativo o retiro del dueño). */
async function retirar(req, res) {
  const cuerpo = req.body || {};
  const monto = v.montoNoNegativo(cuerpo.monto, 'monto del retiro', LIMITES.MAX_MONTO);
  if (monto <= 0) throw new ErrorNegocio('El monto del retiro debe ser mayor que cero');
  const justificacion = v.textoRequerido(cuerpo.justificacion, 'justificación', 200);
  const resultado = await cajaService.retirar(req.hotelId, req.usuario, monto, justificacion);
  return ok(res, resultado, 'Retiro registrado: ' + resultado.nota);
}

/** Retiros/notas de la caja abierta (pantalla operativa). */
async function retiros(req, res) {
  const datos = await cajaService.retirosCajaAbierta(req.hotelId);
  return ok(res, datos);
}

/** Historial de gastos del hotel con rango de fechas (dueño). */
async function gastos(req, res) {
  const query = req.query || {};
  const esFecha = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);
  if (query.desde && !esFecha(query.desde)) throw new ErrorNegocio('La fecha "desde" debe ser AAAA-MM-DD');
  if (query.hasta && !esFecha(query.hasta)) throw new ErrorNegocio('La fecha "hasta" debe ser AAAA-MM-DD');
  const datos = await cajaService.gastosDelHotel(req.hotelId, query.desde, query.hasta);
  return ok(res, datos);
}

/** Notas de un turno del historial (auditoría del dueño). */
async function notasDeTurno(req, res) {
  const turnoId = v.idValido(req.params.id, 'turno');
  const datos = await cajaService.notasDeTurno(req.hotelId, turnoId);
  return ok(res, datos);
}

async function historial(req, res) {
  const datos = await cajaService.historial(req.hotelId);
  return ok(res, datos);
}

module.exports = { estado, abrir, cerrar, retirar, retiros, gastos, notasDeTurno, historial };
