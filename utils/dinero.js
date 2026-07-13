// ============================================================
// Utilidades monetarias. Todos los cálculos de dinero se hacen
// en el backend con redondeo a 2 decimales (quetzales).
// ============================================================

/** Redondea a 2 decimales evitando errores de coma flotante. */
function redondear(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/** Convierte a número; devuelve NaN si no es convertible. */
function aNumero(v) {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

/** Multiplica precio × cantidad con redondeo monetario. */
function multiplicar(precio, cantidad) {
  return redondear(Number(precio) * Number(cantidad));
}

/** Suma una lista de montos con redondeo monetario. */
function sumar(...montos) {
  return redondear(montos.reduce((acc, m) => acc + Number(m || 0), 0));
}

module.exports = { redondear, aNumero, multiplicar, sumar };
