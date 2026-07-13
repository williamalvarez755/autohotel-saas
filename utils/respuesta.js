// ============================================================
// Formato estándar de respuesta de la API:
//   { success: true,  message: '', data: {...} }
//   { success: false, message: 'Descripción del error', data: null }
// ============================================================

function ok(res, data = {}, message = '') {
  return res.json({ success: true, message, data });
}

function fallo(res, status, message) {
  return res.status(status).json({ success: false, message, data: null });
}

module.exports = { ok, fallo };
