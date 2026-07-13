// ============================================================
// Utilidades de fecha/hora en horario de Guatemala (GMT-6).
// Guatemala no usa horario de verano, por lo que el desfase es
// fijo. Todas las fechas se guardan en la BD como hora local GT
// en formato 'YYYY-MM-DD HH:MM:SS'; el backend calcula "ahora"
// y lo pasa siempre como parámetro a las consultas (nunca se
// depende de la zona horaria del servidor MySQL).
// ============================================================

const OFFSET_GT_MS = -6 * 60 * 60 * 1000;

/** Rellena con ceros a 2 dígitos. */
function dosDigitos(n) {
  return String(n).padStart(2, '0');
}

/** Date cuyo reloj UTC interno representa la hora local de Guatemala. */
function fechaGT(epochMs = Date.now()) {
  return new Date(epochMs + OFFSET_GT_MS);
}

/** Convierte un Date "desplazado a GT" a 'YYYY-MM-DD HH:MM:SS'. */
function formatearFechaHora(d) {
  return (
    d.getUTCFullYear() + '-' + dosDigitos(d.getUTCMonth() + 1) + '-' + dosDigitos(d.getUTCDate()) +
    ' ' + dosDigitos(d.getUTCHours()) + ':' + dosDigitos(d.getUTCMinutes()) + ':' + dosDigitos(d.getUTCSeconds())
  );
}

/** Hora actual de Guatemala como 'YYYY-MM-DD HH:MM:SS'. */
function ahoraGT() {
  return formatearFechaHora(fechaGT());
}

/** Fecha actual de Guatemala como 'YYYY-MM-DD'. */
function hoyGT() {
  return ahoraGT().slice(0, 10);
}

/** Mes actual de Guatemala como 'YYYY-MM'. */
function mesActualGT() {
  return ahoraGT().slice(0, 7);
}

/** Epoch (ms) de una fecha-hora guardada en hora de Guatemala. */
function aEpoch(fechaHoraGT) {
  if (!fechaHoraGT) return null;
  const iso = String(fechaHoraGT).replace(' ', 'T') + '-06:00';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** Suma horas a una fecha-hora GT y devuelve la nueva cadena. */
function sumarHoras(fechaHoraGT, horas) {
  const ms = aEpoch(fechaHoraGT) + horas * 60 * 60 * 1000;
  return formatearFechaHora(fechaGT(ms));
}

/** Minutos transcurridos desde una fecha-hora GT hasta ahora (puede ser negativo). */
function minutosTranscurridos(fechaHoraGT) {
  const ms = aEpoch(fechaHoraGT);
  if (ms === null) return 0;
  return Math.floor((Date.now() - ms) / 60000);
}

/**
 * Horas extra a cobrar: tiempo excedido sobre la salida prevista,
 * redondeado hacia arriba. 0 si no se ha excedido.
 */
function horasExtra(horaSalidaPrevista, epochAhora = Date.now()) {
  const prevista = aEpoch(horaSalidaPrevista);
  if (prevista === null || epochAhora <= prevista) return 0;
  return Math.ceil((epochAhora - prevista) / (60 * 60 * 1000));
}

/** Fecha-hora GT de hace N minutos (para cortes de alertas). */
function haceMinutos(minutos) {
  return formatearFechaHora(fechaGT(Date.now() - minutos * 60000));
}

/** Valida formato 'YYYY-MM-DD' y que sea una fecha real. */
function esFechaValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  return aEpoch(texto + ' 00:00:00') !== null;
}

/** Valida formato 'YYYY-MM-DD HH:MM' o 'YYYY-MM-DD HH:MM:SS'. */
function esFechaHoraValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(texto)) return false;
  const completa = texto.length === 16 ? texto + ':00' : texto;
  return aEpoch(completa) !== null;
}

/** Normaliza 'YYYY-MM-DD HH:MM' a 'YYYY-MM-DD HH:MM:SS'. */
function normalizarFechaHora(texto) {
  return texto.length === 16 ? texto + ':00' : texto;
}

module.exports = {
  ahoraGT,
  hoyGT,
  mesActualGT,
  aEpoch,
  sumarHoras,
  haceMinutos,
  minutosTranscurridos,
  horasExtra,
  esFechaValida,
  esFechaHoraValida,
  normalizarFechaHora
};
