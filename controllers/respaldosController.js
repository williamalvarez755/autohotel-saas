// ============================================================
// Controlador de respaldos completos (solo superadmin).
// Descarga/restauración del sistema entero + respaldos guardados
// en el servidor (incluye los automáticos pre-restauración y los
// de la limpieza programada). Toda acción queda auditada con IP.
// ============================================================

const respaldosService = require('../services/respaldosService');
const auditoriaService = require('../services/auditoriaService');
const { ok } = require('../utils/respuesta');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT } = require('../utils/fechas');

/** Descarga el respaldo completo del sistema como archivo JSON. */
async function descargar(req, res) {
  const datos = await respaldosService.exportar();
  const totales = respaldosService.conteos(datos);
  const totalFilas = Object.values(totales).reduce((s, n) => s + n, 0);
  await auditoriaService.registrar(req.usuario, req, 'respaldo.descargar',
    `Respaldo completo descargado (${totalFilas} filas)`);

  const marca = ahoraGT().replace(/[: ]/g, '-');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="respaldo-autohotel-completo-${marca}.json"`);
  return res.send(JSON.stringify(datos, null, 2));
}

/** Restaura un respaldo subido (reemplaza TODOS los datos). */
async function restaurar(req, res) {
  const cuerpo = req.body || {};
  if (!cuerpo.respaldo || typeof cuerpo.respaldo !== 'object') {
    throw new ErrorNegocio('Debe adjuntar el contenido del respaldo');
  }
  const resultado = await respaldosService.restaurar(
    req.usuario, req, cuerpo.respaldo, cuerpo.confirmacion
  );
  return ok(res, resultado,
    'Respaldo restaurado. Las demás sesiones fueron cerradas por seguridad');
}

/** Lista los respaldos guardados en el servidor. */
async function listarArchivos(req, res) {
  return ok(res, respaldosService.listarArchivos());
}

/** Descarga un respaldo guardado en el servidor (nombre validado). */
async function descargarArchivo(req, res) {
  const ruta = respaldosService.rutaArchivo(req.params.nombre);
  await auditoriaService.registrar(req.usuario, req, 'respaldo.descargar_guardado',
    `Descarga del respaldo guardado ${req.params.nombre}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.nombre}"`);
  return res.sendFile(ruta);
}

module.exports = { descargar, restaurar, listarArchivos, descargarArchivo };
