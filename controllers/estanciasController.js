// ============================================================
// Controlador de estancias: entrada, cobro base, salida.
// ============================================================

const estanciasService = require('../services/estanciasService');
const { ok } = require('../utils/respuesta');
const { TIPOS_ESTANCIA, METODOS_PAGO, LIMITES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const v = require('../utils/validacion');

/** Valida método de pago y efectivo recibido; devuelve ambos. */
function validarPago(cuerpo, obligatorio) {
  if (!cuerpo.metodo && !obligatorio) return { metodo: null, efectivo: 0 };
  const metodo = v.opcionValida(cuerpo.metodo, 'método de pago', METODOS_PAGO);
  let efectivo = 0;
  if (metodo === 'efectivo') {
    efectivo = v.montoNoNegativo(cuerpo.efectivo_recibido, 'efectivo recibido', LIMITES.MAX_MONTO);
  }
  return { metodo, efectivo };
}

async function registrarEntrada(req, res) {
  const cuerpo = req.body || {};
  // Extras opcionales elegidos (ids del menú de la habitación)
  let extras = [];
  if (cuerpo.extras !== undefined && cuerpo.extras !== null) {
    if (!Array.isArray(cuerpo.extras) || cuerpo.extras.length > LIMITES.MAX_EXTRAS_POR_HABITACION) {
      throw new ErrorNegocio('Los extras deben ser una lista de identificadores válida');
    }
    extras = [...new Set(cuerpo.extras.map((id) => v.idValido(id, 'extra')))];
  }

  const datos = {
    habitacion_id: v.idValido(cuerpo.habitacion_id, 'habitacion_id'),
    // Opcional: hay clientes que llegan a pie (sin vehículo)
    placa: v.textoOpcional(cuerpo.placa, 'placa del vehículo', 20).toUpperCase(),
    tipo: v.opcionValida(cuerpo.tipo, 'tipo de servicio', Object.values(TIPOS_ESTANCIA)),
    tarifa_id: null,
    reserva_id: cuerpo.reserva_id ? v.idValido(cuerpo.reserva_id, 'reserva_id') : null,
    extras
  };
  // La entrada por tiempo exige elegir una tarifa de la habitación;
  // el precio y la duración los dicta la tarifa en el backend.
  if (datos.tipo === TIPOS_ESTANCIA.HORAS) {
    datos.tarifa_id = v.idValido(cuerpo.tarifa_id, 'tarifa_id');
  }
  const estancia = await estanciasService.registrarEntrada(req.hotel, req.usuario.id, datos);
  return ok(res, estancia, 'Entrada registrada');
}

async function pagarBase(req, res) {
  const id = v.idValido(req.params.id);
  const { metodo, efectivo } = validarPago(req.body || {}, true);
  if (!metodo) throw new ErrorNegocio('Debe indicar el método de pago');
  const resultado = await estanciasService.pagarBase(req.hotelId, req.usuario, id, metodo, efectivo);
  return ok(res, resultado, 'Cobro base registrado');
}

async function listarActivas(req, res) {
  const datos = await estanciasService.listarActivas(req.hotelId);
  return ok(res, datos);
}

async function detalle(req, res) {
  const id = v.idValido(req.params.id);
  const datos = await estanciasService.detalle(req.hotelId, id);
  return ok(res, datos);
}

async function preSalida(req, res) {
  const id = v.idValido(req.params.id);
  const datos = await estanciasService.preSalida(req.hotelId, id);
  return ok(res, datos);
}

async function finalizar(req, res) {
  const id = v.idValido(req.params.id);
  const { metodo, efectivo } = validarPago(req.body || {}, false);
  const resultado = await estanciasService.finalizar(req.hotelId, req.usuario, id, metodo, efectivo);
  return ok(res, resultado, 'Estancia finalizada');
}

module.exports = { registrarEntrada, pagarBase, listarActivas, detalle, preSalida, finalizar };
