// ============================================================
// Manejo centralizado de errores.
// - ErrorNegocio: errores esperados de reglas de negocio, cuyo
//   mensaje SÍ se muestra al usuario.
// - Cualquier otro error (SQL, programación) se registra en el
//   log del servidor y al usuario solo se le devuelve un mensaje
//   genérico: nunca se exponen detalles internos.
// ============================================================

const { MENSAJES } = require('../config/constantes');
const { fallo } = require('../utils/respuesta');

class ErrorNegocio extends Error {
  constructor(mensaje, status = 400) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
  }
}

/** Envuelve controladores async para capturar errores y pasarlos a next(). */
function envolverAsync(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 404 para rutas de API inexistentes. */
function rutaNoEncontrada(req, res) {
  return fallo(res, 404, MENSAJES.NO_ENCONTRADO);
}

/** Manejador final de errores de Express. */
// eslint-disable-next-line no-unused-vars
function manejadorErrores(err, req, res, next) {
  if (err instanceof ErrorNegocio) {
    return fallo(res, err.status, err.message);
  }
  // JSON malformado en el body
  if (err.type === 'entity.parse.failed') {
    return fallo(res, 400, 'El cuerpo de la petición no es un JSON válido');
  }
  console.error(`[ERROR] ${req.method} ${req.originalUrl}:`, err);
  return fallo(res, 500, MENSAJES.ERROR_INTERNO);
}

module.exports = { ErrorNegocio, envolverAsync, rutaNoEncontrada, manejadorErrores };
