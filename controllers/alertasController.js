// ============================================================
// Controlador de alertas.
// ============================================================

const alertasService = require('../services/alertasService');
const { ok } = require('../utils/respuesta');

async function obtener(req, res) {
  const datos = await alertasService.obtener(req.hotel);
  return ok(res, datos);
}

module.exports = { obtener };
