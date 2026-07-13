// ============================================================
// Controlador del superadmin: dueños, hoteles, suscripciones
// y pagos de mensualidad.
// ============================================================

const superadminService = require('../services/superadminService');
const { ok } = require('../utils/respuesta');
const { hoyGT, esFechaValida, mesActualGT } = require('../utils/fechas');
const { ErrorNegocio } = require('../middleware/errores');
const { LIMITES } = require('../config/constantes');
const v = require('../utils/validacion');

async function listarDuenos(req, res) {
  const datos = await superadminService.listarDuenos();
  return ok(res, datos);
}

async function crearDueno(req, res) {
  const cuerpo = req.body || {};
  let vencimiento = cuerpo.fecha_vencimiento;
  if (vencimiento) {
    if (!esFechaValida(vencimiento)) {
      throw new ErrorNegocio('La fecha de vencimiento debe tener formato AAAA-MM-DD');
    }
  } else {
    vencimiento = superadminService.sumarUnMes(hoyGT());
  }
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    usuario: v.nombreUsuario(cuerpo.usuario),
    password: v.contrasena(cuerpo.password),
    fecha_vencimiento: vencimiento
  };
  const resultado = await superadminService.crearDueno(datos);
  return ok(res, resultado, 'Dueño creado');
}

async function editarDueno(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    password: cuerpo.password ? v.contrasena(cuerpo.password) : null
  };
  const resultado = await superadminService.editarDueno(id, datos);
  return ok(res, resultado, 'Dueño actualizado');
}

async function suspender(req, res) {
  const id = v.idValido(req.params.id);
  const resultado = await superadminService.cambiarSuspension(id, true);
  return ok(res, resultado, 'Cuenta suspendida');
}

async function reactivar(req, res) {
  const id = v.idValido(req.params.id);
  const resultado = await superadminService.cambiarSuspension(id, false);
  return ok(res, resultado, 'Cuenta reactivada');
}

async function registrarPago(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const monto = v.montoNoNegativo(cuerpo.monto, 'monto', LIMITES.MAX_MONTO);
  if (monto <= 0) throw new ErrorNegocio('El monto del pago debe ser mayor que cero');
  const datos = {
    monto,
    mes_correspondiente: cuerpo.mes_correspondiente
      ? v.mesValido(cuerpo.mes_correspondiente)
      : mesActualGT(),
    nota: v.textoOpcional(cuerpo.nota, 'nota', 200)
  };
  const resultado = await superadminService.registrarPago(req.usuario.id, id, datos);
  return ok(res, resultado, 'Pago registrado y suscripción extendida');
}

async function pagosDeDueno(req, res) {
  const id = v.idValido(req.params.id);
  const datos = await superadminService.pagosDeDueno(id);
  return ok(res, datos);
}

function validarDatosHotel(cuerpo) {
  return {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    direccion: v.textoOpcional(cuerpo.direccion, 'dirección', 200),
    minutos_alerta_limpieza: cuerpo.minutos_alerta_limpieza === undefined || cuerpo.minutos_alerta_limpieza === ''
      ? 30
      : v.enteroPositivo(cuerpo.minutos_alerta_limpieza, 'minutos de alerta de limpieza', 1440),
    horas_noche: cuerpo.horas_noche === undefined || cuerpo.horas_noche === ''
      ? 12
      : v.enteroPositivo(cuerpo.horas_noche, 'horas por noche', 24)
  };
}

async function crearHotel(req, res) {
  const cuerpo = req.body || {};
  const datos = validarDatosHotel(cuerpo);
  datos.dueno_id = v.idValido(cuerpo.dueno_id, 'dueno_id');
  const resultado = await superadminService.crearHotel(datos);
  return ok(res, resultado, 'Hotel creado');
}

async function editarHotel(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const datos = validarDatosHotel(cuerpo);
  datos.activo = v.booleano(cuerpo.activo !== undefined ? cuerpo.activo : true, 'activo');
  const resultado = await superadminService.editarHotel(id, datos);
  return ok(res, resultado, 'Hotel actualizado');
}

module.exports = {
  listarDuenos,
  crearDueno,
  editarDueno,
  suspender,
  reactivar,
  registrarPago,
  pagosDeDueno,
  crearHotel,
  editarHotel
};
