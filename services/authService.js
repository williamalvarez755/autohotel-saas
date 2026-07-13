// ============================================================
// Servicio de autenticación: login, información de sesión y
// cambio de hotel activo para dueños con varios hoteles.
// ============================================================

const bcrypt = require('bcrypt');
const { pool } = require('../db/pool');
const { ROLES, MENSAJES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { suscripcionBloqueada } = require('../middleware/auth');
const { hotelesDeDueno } = require('../middleware/tenant');

// Hash de relleno para igualar el tiempo de respuesta cuando el
// usuario no existe (evita enumeración de usuarios por tiempos).
const HASH_RELLENO = '$2b$10$3euPcmQFCiblsZeEu5s7p.9BUe7sTWc8HTsG9lqCwrDkASOFOKWXa';

/**
 * Valida credenciales y estado de la cuenta.
 * Devuelve el usuario listo para guardar en sesión o lanza
 * ErrorNegocio con el mensaje correspondiente.
 */
async function login(nombreUsuario, password) {
  const [filas] = await pool.query(
    `SELECT u.id, u.rol, u.nombre, u.usuario, u.password_hash, u.dueno_id, u.hotel_id, u.activo,
            s.estado AS suscripcion_estado, s.fecha_vencimiento
       FROM usuarios u
       LEFT JOIN suscripciones s ON s.dueno_id = COALESCE(u.dueno_id, u.id)
      WHERE u.usuario = ?
      LIMIT 1`,
    [nombreUsuario]
  );
  const usuario = filas[0];

  const passwordCorrecta = await bcrypt.compare(password, usuario ? usuario.password_hash : HASH_RELLENO);
  if (!usuario || !passwordCorrecta) {
    throw new ErrorNegocio(MENSAJES.CREDENCIALES, 401);
  }
  if (!usuario.activo) {
    throw new ErrorNegocio(MENSAJES.USUARIO_DESACTIVADO, 403);
  }
  if (suscripcionBloqueada(usuario)) {
    throw new ErrorNegocio(MENSAJES.SUSPENDIDO, 403);
  }

  // El trabajador necesita que su hotel exista y esté activo.
  if (usuario.rol === ROLES.TRABAJADOR) {
    const [hoteles] = await pool.query(
      'SELECT id FROM hoteles WHERE id = ? AND activo = 1 LIMIT 1',
      [usuario.hotel_id]
    );
    if (!hoteles.length) {
      throw new ErrorNegocio('El hotel asignado no está disponible, comuníquese con el dueño', 403);
    }
  }

  return usuario;
}

/** Ruta de destino según el rol. */
function rutaSegunRol(rol) {
  return rol === ROLES.SUPERADMIN ? '/superadmin' : '/app';
}

/**
 * Información de la sesión actual para el frontend:
 * datos del usuario y, si es dueño, sus hoteles y el hotel activo.
 */
async function infoSesion(usuario, session) {
  const datos = {
    id: usuario.id,
    rol: usuario.rol,
    nombre: usuario.nombre,
    usuario: usuario.usuario,
    redirect: rutaSegunRol(usuario.rol),
    hoteles: [],
    hotel_activo_id: null
  };

  if (usuario.rol === ROLES.DUENO) {
    const hoteles = await hotelesDeDueno(usuario.id);
    let activo = hoteles.find((h) => h.id === session.hotelActivoId);
    if (!activo && hoteles.length) {
      activo = hoteles[0];
      session.hotelActivoId = activo.id;
    }
    datos.hoteles = hoteles.map((h) => ({ id: h.id, nombre: h.nombre }));
    datos.hotel_activo_id = activo ? activo.id : null;
  }

  if (usuario.rol === ROLES.TRABAJADOR) {
    const [hoteles] = await pool.query(
      'SELECT id, nombre FROM hoteles WHERE id = ? LIMIT 1',
      [usuario.hotel_id]
    );
    if (hoteles.length) {
      datos.hoteles = [hoteles[0]];
      datos.hotel_activo_id = hoteles[0].id;
    }
  }

  return datos;
}

/** Cambia el hotel activo de un dueño, validando que le pertenezca. */
async function cambiarHotelActivo(usuario, session, hotelId) {
  if (usuario.rol !== ROLES.DUENO) {
    throw new ErrorNegocio('Solo los dueños pueden cambiar de hotel', 403);
  }
  const [filas] = await pool.query(
    'SELECT id, nombre FROM hoteles WHERE id = ? AND dueno_id = ? AND activo = 1 LIMIT 1',
    [hotelId, usuario.id]
  );
  if (!filas.length) {
    throw new ErrorNegocio('El hotel indicado no le pertenece o no está activo', 403);
  }
  session.hotelActivoId = filas[0].id;
  return { hotel_activo_id: filas[0].id, nombre: filas[0].nombre };
}

module.exports = { login, infoSesion, cambiarHotelActivo, rutaSegunRol };
