// ============================================================
// Controlador de Consultas Avanzadas y Limpieza de Datos
// (módulos exclusivos del superadmin).
// ============================================================

const consultasService = require('../services/consultasService');
const limpiezaService = require('../services/limpiezaService');
const auditoriaService = require('../services/auditoriaService');
const { ok } = require('../utils/respuesta');
const { esFechaValida } = require('../utils/fechas');
const { ErrorNegocio } = require('../middleware/errores');
const v = require('../utils/validacion');

/** Filtros comunes de las consultas (todos opcionales). */
function validarFiltros(query) {
  const filtros = {};
  if (query.desde) {
    if (!esFechaValida(query.desde)) throw new ErrorNegocio('La fecha "desde" debe ser AAAA-MM-DD');
    filtros.desde = query.desde;
  }
  if (query.hasta) {
    if (!esFechaValida(query.hasta)) throw new ErrorNegocio('La fecha "hasta" debe ser AAAA-MM-DD');
    filtros.hasta = query.hasta;
  }
  if (query.hotel_id) filtros.hotel_id = v.idValido(query.hotel_id, 'hotel_id');
  filtros.busqueda = v.textoOpcional(query.busqueda, 'búsqueda', 100);
  filtros.estado = v.textoOpcional(query.estado, 'estado', 20);
  return filtros;
}

async function consultar(req, res) {
  const tipo = v.textoRequerido(req.params.tipo, 'tipo de consulta', 40);
  const filtros = validarFiltros(req.query || {});
  const datos = await consultasService.ejecutar(tipo, filtros);
  return ok(res, datos);
}

async function hotelesFiltro(req, res) {
  return ok(res, await consultasService.hotelesParaFiltro());
}

// ---------------- Limpieza de datos ----------------

function validarFechaLimite(valor) {
  if (!esFechaValida(valor)) {
    throw new ErrorNegocio('La fecha límite debe tener formato AAAA-MM-DD');
  }
  return `${valor} 00:00:00`;
}

async function limpiezaResumen(req, res) {
  const fecha = validarFechaLimite((req.query || {}).fecha);
  return ok(res, await limpiezaService.resumen(fecha));
}

/** Descarga el respaldo JSON de lo que sería eliminado. */
async function limpiezaRespaldo(req, res) {
  const query = req.query || {};
  const fecha = validarFechaLimite(query.fecha);
  const tipos = String(query.tipos || '').split(',').filter(Boolean);
  const datos = await limpiezaService.respaldo(fecha, tipos);
  await auditoriaService.registrar(req.usuario, req, 'limpieza.respaldo',
    `Respaldo previo a limpieza (antes de ${fecha}): ${tipos.join(', ')}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="respaldo-autohotel-${query.fecha}.json"`);
  return res.send(JSON.stringify(datos, null, 2));
}

async function limpiezaEjecutar(req, res) {
  const cuerpo = req.body || {};
  const fecha = validarFechaLimite(cuerpo.fecha);
  const resultado = await limpiezaService.ejecutar(
    req.usuario, req, fecha, cuerpo.tipos, cuerpo.confirmacion
  );
  return ok(res, resultado,
    `Limpieza ejecutada: ${resultado.total_eliminados} registro(s) eliminados`);
}

// ---------------- Políticas de retención ----------------

async function politicas(req, res) {
  return ok(res, await limpiezaService.listarPoliticas());
}

async function actualizarPolitica(req, res) {
  const cuerpo = req.body || {};
  const tipo = v.textoRequerido(cuerpo.tipo, 'tipo', 40);
  const meses = v.enteroNoNegativo(cuerpo.meses, 'meses', 240);
  const programada = v.opcionValida(cuerpo.programada, 'programada',
    ['manual', 'mensual', 'trimestral', 'anual']);
  const resultado = await limpiezaService.actualizarPolitica(req.usuario, req, tipo, meses, programada);
  return ok(res, resultado, 'Política de retención actualizada');
}

module.exports = {
  consultar,
  hotelesFiltro,
  limpiezaResumen,
  limpiezaRespaldo,
  limpiezaEjecutar,
  politicas,
  actualizarPolitica
};
