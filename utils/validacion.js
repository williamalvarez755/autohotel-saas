// ============================================================
// Validación de entradas. Nunca se confía en datos del frontend:
// cada controlador valida aquí antes de llegar a los servicios.
// Cada función lanza ErrorNegocio (400) si el dato es inválido.
// ============================================================

const { ErrorNegocio } = require('../middleware/errores');

/** Texto obligatorio, recortado, con longitud máxima. */
function textoRequerido(valor, campo, max = 100) {
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErrorNegocio(`El campo "${campo}" es obligatorio`);
  }
  const limpio = valor.trim();
  if (limpio.length > max) {
    throw new ErrorNegocio(`El campo "${campo}" no puede exceder ${max} caracteres`);
  }
  return limpio;
}

/** Texto opcional: devuelve '' si viene vacío o ausente. */
function textoOpcional(valor, campo, max = 200) {
  if (valor === undefined || valor === null || valor === '') return '';
  if (typeof valor !== 'string') {
    throw new ErrorNegocio(`El campo "${campo}" no es válido`);
  }
  const limpio = valor.trim();
  if (limpio.length > max) {
    throw new ErrorNegocio(`El campo "${campo}" no puede exceder ${max} caracteres`);
  }
  return limpio;
}

/** Entero >= 1. */
function enteroPositivo(valor, campo, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ErrorNegocio(`El campo "${campo}" debe ser un número entero entre 1 y ${max}`);
  }
  return n;
}

/** Entero >= 0. */
function enteroNoNegativo(valor, campo, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > max) {
    throw new ErrorNegocio(`El campo "${campo}" debe ser un número entero entre 0 y ${max}`);
  }
  return n;
}

/** Monto en quetzales: número >= 0 con hasta 2 decimales. */
function montoNoNegativo(valor, campo, max = 1000000) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0 || n > max) {
    throw new ErrorNegocio(`El campo "${campo}" debe ser un monto entre 0 y ${max}`);
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Valor dentro de una lista permitida. */
function opcionValida(valor, campo, opciones) {
  if (!opciones.includes(valor)) {
    throw new ErrorNegocio(`El campo "${campo}" debe ser uno de: ${opciones.join(', ')}`);
  }
  return valor;
}

/** Booleano flexible (true/false, 1/0). */
function booleano(valor, campo) {
  if (valor === true || valor === 1 || valor === '1') return 1;
  if (valor === false || valor === 0 || valor === '0') return 0;
  throw new ErrorNegocio(`El campo "${campo}" debe ser verdadero o falso`);
}

/** Identificador de recurso (entero positivo). */
function idValido(valor, campo = 'id') {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) {
    throw new ErrorNegocio(`El identificador "${campo}" no es válido`);
  }
  return n;
}

/** Nombre de usuario: letras, números, punto y guion bajo. */
function nombreUsuario(valor) {
  const limpio = textoRequerido(valor, 'usuario', 50).toLowerCase();
  if (!/^[a-z0-9._-]{3,50}$/.test(limpio)) {
    throw new ErrorNegocio('El usuario debe tener de 3 a 50 caracteres: letras, números, punto, guion o guion bajo');
  }
  return limpio;
}

/** Contraseña: mínimo 6 caracteres. */
function contrasena(valor) {
  if (typeof valor !== 'string' || valor.length < 6 || valor.length > 72) {
    throw new ErrorNegocio('La contraseña debe tener entre 6 y 72 caracteres');
  }
  return valor;
}

/** Mes 'YYYY-MM'. */
function mesValido(valor, campo = 'mes_correspondiente') {
  if (typeof valor !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(valor)) {
    throw new ErrorNegocio(`El campo "${campo}" debe tener formato AAAA-MM`);
  }
  return valor;
}

module.exports = {
  textoRequerido,
  textoOpcional,
  enteroPositivo,
  enteroNoNegativo,
  montoNoNegativo,
  opcionValida,
  booleano,
  idValido,
  nombreUsuario,
  contrasena,
  mesValido
};
