// ============================================================
// Controlador de habitaciones y limpieza.
// ============================================================

const habitacionesService = require('../services/habitacionesService');
const { ok } = require('../utils/respuesta');
const { ESTADOS_HABITACION, LIMITES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const v = require('../utils/validacion');

async function tablero(req, res) {
  const datos = await habitacionesService.tablero(req.hotelId);
  return ok(res, datos);
}

async function listarAdmin(req, res) {
  const datos = await habitacionesService.listarAdmin(req.hotelId);
  return ok(res, datos);
}

/**
 * Valida el menú de tarifas de una habitación: lista de paquetes
 * { nombre, horas, precio }. Debe haber al menos una tarifa para
 * que la habitación pueda venderse por tiempo.
 */
function validarTarifas(valor) {
  if (!Array.isArray(valor) || !valor.length) {
    throw new ErrorNegocio('Debe definir al menos una tarifa (nombre, horas y precio)');
  }
  if (valor.length > LIMITES.MAX_TARIFAS_POR_HABITACION) {
    throw new ErrorNegocio(`Máximo ${LIMITES.MAX_TARIFAS_POR_HABITACION} tarifas por habitación`);
  }
  const nombres = new Set();
  return valor.map((t) => {
    const cuerpo = t || {};
    const tarifa = {
      nombre: v.textoRequerido(cuerpo.nombre, 'nombre de la tarifa', 60),
      horas: v.enteroPositivo(cuerpo.horas, 'horas de la tarifa', LIMITES.MAX_HORAS_CONTRATADAS),
      precio: v.montoNoNegativo(cuerpo.precio, 'precio de la tarifa', LIMITES.MAX_MONTO)
    };
    const clave = tarifa.nombre.toLowerCase();
    if (nombres.has(clave)) {
      throw new ErrorNegocio(`La tarifa "${tarifa.nombre}" está repetida`);
    }
    nombres.add(clave);
    return tarifa;
  });
}

/**
 * Valida los extras opcionales de una habitación (0 a N): lista de
 * { nombre, precio }. Vacío = la habitación no ofrece extras.
 */
function validarExtras(valor) {
  if (valor === undefined || valor === null) return [];
  if (!Array.isArray(valor)) {
    throw new ErrorNegocio('Los extras deben ser una lista de { nombre, precio }');
  }
  if (valor.length > LIMITES.MAX_EXTRAS_POR_HABITACION) {
    throw new ErrorNegocio(`Máximo ${LIMITES.MAX_EXTRAS_POR_HABITACION} extras por habitación`);
  }
  const nombres = new Set();
  return valor.map((e) => {
    const cuerpo = e || {};
    const extra = {
      nombre: v.textoRequerido(cuerpo.nombre, 'nombre del extra', 60),
      precio: v.montoNoNegativo(cuerpo.precio, 'precio del extra', LIMITES.MAX_MONTO)
    };
    if (extra.precio <= 0) {
      throw new ErrorNegocio(`El extra "${extra.nombre}" debe tener un precio mayor que cero`);
    }
    const clave = extra.nombre.toLowerCase();
    if (nombres.has(clave)) {
      throw new ErrorNegocio(`El extra "${extra.nombre}" está repetido`);
    }
    nombres.add(clave);
    return extra;
  });
}

function validarDatosHabitacion(cuerpo) {
  return {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 50),
    precio_noche: v.montoNoNegativo(cuerpo.precio_noche, 'precio por noche', LIMITES.MAX_MONTO),
    precio_hora_extra: v.montoNoNegativo(cuerpo.precio_hora_extra, 'precio por hora extra', LIMITES.MAX_MONTO),
    tarifas: validarTarifas(cuerpo.tarifas),
    extras: validarExtras(cuerpo.extras)
  };
}

async function crear(req, res) {
  const datos = validarDatosHabitacion(req.body || {});
  const resultado = await habitacionesService.crear(req.hotelId, datos);
  return ok(res, resultado, 'Habitación creada');
}

async function editar(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const datos = validarDatosHabitacion(cuerpo);
  datos.activo = v.booleano(cuerpo.activo !== undefined ? cuerpo.activo : true, 'activo');
  const resultado = await habitacionesService.editar(req.hotelId, id, datos);
  return ok(res, resultado, 'Habitación actualizada');
}

async function cambiarEstado(req, res) {
  const id = v.idValido(req.params.id);
  const estado = v.opcionValida(
    (req.body || {}).estado,
    'estado',
    [ESTADOS_HABITACION.DISPONIBLE, ESTADOS_HABITACION.LIMPIEZA]
  );
  const resultado = await habitacionesService.cambiarEstadoManual(req.hotelId, id, estado);
  return ok(res, resultado, 'Estado actualizado');
}

async function listaLimpieza(req, res) {
  const datos = await habitacionesService.listaLimpieza(req.hotelId, req.hotel.minutos_alerta_limpieza);
  return ok(res, datos);
}

async function marcarLimpia(req, res) {
  const id = v.idValido(req.params.id);
  const resultado = await habitacionesService.marcarLimpia(req.hotelId, id);
  return ok(res, resultado, 'Habitación disponible');
}

module.exports = { tablero, listarAdmin, crear, editar, cambiarEstado, listaLimpieza, marcarLimpia };
