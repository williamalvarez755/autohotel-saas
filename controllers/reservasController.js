// ============================================================
// Controlador de reservas.
// ============================================================

const reservasService = require('../services/reservasService');
const { ok } = require('../utils/respuesta');
const { esFechaHoraValida, normalizarFechaHora } = require('../utils/fechas');
const { ErrorNegocio } = require('../middleware/errores');
const { LIMITES } = require('../config/constantes');
const v = require('../utils/validacion');

async function listar(req, res) {
  const datos = await reservasService.listar(req.hotelId);
  return ok(res, datos);
}

async function crear(req, res) {
  const cuerpo = req.body || {};
  if (!esFechaHoraValida(cuerpo.fecha_hora)) {
    throw new ErrorNegocio('La fecha y hora debe tener formato AAAA-MM-DD HH:MM');
  }
  const datos = {
    habitacion_id: v.idValido(cuerpo.habitacion_id, 'habitacion_id'),
    fecha_hora: normalizarFechaHora(cuerpo.fecha_hora),
    placa: v.textoOpcional(cuerpo.placa, 'placa', 20).toUpperCase(),
    nota: v.textoOpcional(cuerpo.nota, 'nota', 200),
    // Recargo por reservar + extras (ej. decoración): opcional, >= 0
    cargo_extra: cuerpo.cargo_extra === undefined || cuerpo.cargo_extra === '' || cuerpo.cargo_extra === null
      ? 0
      : v.montoNoNegativo(cuerpo.cargo_extra, 'cargo adicional', LIMITES.MAX_MONTO),
    cargo_descripcion: v.textoOpcional(cuerpo.cargo_descripcion, 'detalle del cargo', 200)
  };
  const resultado = await reservasService.crear(req.hotelId, req.usuario.id, datos);
  return ok(res, resultado, 'Reserva creada');
}

async function cancelar(req, res) {
  const id = v.idValido(req.params.id);
  const resultado = await reservasService.cancelar(req.hotelId, id);
  return ok(res, resultado, 'Reserva cancelada');
}

module.exports = { listar, crear, cancelar };
