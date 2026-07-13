// ============================================================
// Controlador de reportes (solo dueño).
// ============================================================

const reportesService = require('../services/reportesService');
const dashboardService = require('../services/dashboardService');
const { ok } = require('../utils/respuesta');
const v = require('../utils/validacion');

function filtros(req) {
  return {
    desde: String(req.query.desde || ''),
    hasta: String(req.query.hasta || ''),
    habitacionId: req.query.habitacion_id ? v.idValido(req.query.habitacion_id, 'habitacion_id') : null
  };
}

async function ingresosPorDia(req, res) {
  const { desde, hasta } = filtros(req);
  const datos = await reportesService.ingresosPorDia(req.hotelId, desde, hasta);
  return ok(res, datos);
}

async function ingresosPorHabitacion(req, res) {
  const { desde, hasta, habitacionId } = filtros(req);
  const datos = await reportesService.ingresosPorHabitacion(req.hotelId, desde, hasta, habitacionId);
  return ok(res, datos);
}

async function productosMasVendidos(req, res) {
  const { desde, hasta } = filtros(req);
  const datos = await reportesService.productosMasVendidos(req.hotelId, desde, hasta);
  return ok(res, datos);
}

async function estancias(req, res) {
  const { desde, hasta, habitacionId } = filtros(req);
  const datos = await reportesService.estancias(req.hotelId, desde, hasta, habitacionId);
  return ok(res, datos);
}

async function dashboard(req, res) {
  const datos = await dashboardService.resumen(req.hotel);
  return ok(res, datos);
}

module.exports = { ingresosPorDia, ingresosPorHabitacion, productosMasVendidos, estancias, dashboard };
