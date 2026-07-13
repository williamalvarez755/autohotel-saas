// ============================================================
// Autenticación y autorización.
// - requiereSesion: verifica la sesión y RE-VALIDA en cada
//   petición que el usuario siga activo y que la suscripción del
//   dueño (propia o del dueño del trabajador) no esté suspendida
//   ni vencida. Así una suspensión surte efecto inmediato aunque
//   haya sesiones abiertas.
// - requiereRol: autorización por rol para cada grupo de rutas.
// - limitadorLogin: limitación básica de intentos de login.
// ============================================================

const { pool } = require('../db/pool');
const { ROLES, MENSAJES, LIMITES } = require('../config/constantes');
const { fallo } = require('../utils/respuesta');
const { hoyGT } = require('../utils/fechas');
const { envolverAsync } = require('./errores');

/**
 * Carga el usuario de la sesión junto con la suscripción de su
 * dueño (para el dueño, la propia; para el trabajador, la de su
 * dueño). Una sola consulta por petición.
 */
async function cargarUsuarioSesion(idUsuario) {
  const [filas] = await pool.query(
    `SELECT u.id, u.rol, u.nombre, u.usuario, u.dueno_id, u.hotel_id, u.activo,
            s.estado AS suscripcion_estado, s.fecha_vencimiento
       FROM usuarios u
       LEFT JOIN suscripciones s ON s.dueno_id = COALESCE(u.dueno_id, u.id)
      WHERE u.id = ?
      LIMIT 1`,
    [idUsuario]
  );
  return filas[0] || null;
}

/** Determina si la suscripción está bloqueada (suspendida o vencida). */
function suscripcionBloqueada(usuario) {
  if (usuario.rol === ROLES.SUPERADMIN) return false;
  if (!usuario.suscripcion_estado) return true; // dueño sin suscripción registrada
  if (usuario.suscripcion_estado === 'suspendida') return true;
  return String(usuario.fecha_vencimiento).slice(0, 10) < hoyGT();
}

const requiereSesion = envolverAsync(async (req, res, next) => {
  const idUsuario = req.session && req.session.usuarioId;
  if (!idUsuario) {
    return fallo(res, 401, MENSAJES.NO_AUTENTICADO);
  }

  const usuario = await cargarUsuarioSesion(idUsuario);

  if (!usuario || !usuario.activo) {
    req.session.destroy(() => {});
    return fallo(res, 401, MENSAJES.USUARIO_DESACTIVADO);
  }
  if (suscripcionBloqueada(usuario)) {
    req.session.destroy(() => {});
    return fallo(res, 403, MENSAJES.SUSPENDIDO);
  }

  req.usuario = usuario;
  next();
});

/** Autorización por rol: requiereRol('dueno', 'trabajador'). */
function requiereRol(...roles) {
  return (req, res, next) => {
    if (!req.usuario || !roles.includes(req.usuario.rol)) {
      return fallo(res, 403, MENSAJES.NO_AUTORIZADO);
    }
    next();
  };
}

// ------------------------------------------------------------
// Limitador de intentos de login en memoria (por IP + usuario).
// Suficiente para una instancia; evita fuerza bruta básica.
// ------------------------------------------------------------
const intentosLogin = new Map();

function limitadorLogin(req, res, next) {
  const clave = `${req.ip}|${String((req.body && req.body.usuario) || '').toLowerCase()}`;
  const ahora = Date.now();
  const registro = intentosLogin.get(clave);

  if (registro && ahora - registro.inicio < LIMITES.LOGIN_VENTANA_MS) {
    if (registro.intentos >= LIMITES.LOGIN_MAX_INTENTOS) {
      return fallo(res, 429, 'Demasiados intentos fallidos. Espere unos minutos e intente de nuevo');
    }
  } else {
    intentosLogin.set(clave, { inicio: ahora, intentos: 0 });
  }

  // Limpieza periódica para no acumular memoria
  if (intentosLogin.size > 5000) {
    for (const [k, v] of intentosLogin) {
      if (ahora - v.inicio > LIMITES.LOGIN_VENTANA_MS) intentosLogin.delete(k);
    }
  }

  req.registrarIntentoFallido = () => {
    const r = intentosLogin.get(clave);
    if (r) r.intentos += 1;
  };
  req.limpiarIntentos = () => intentosLogin.delete(clave);
  next();
}

module.exports = { requiereSesion, requiereRol, limitadorLogin, suscripcionBloqueada };
