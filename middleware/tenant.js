// ============================================================
// Middleware multi-tenant: resuelve y valida el hotel sobre el
// que opera la petición (req.hotelId).
//
// - Trabajador: SIEMPRE su propio hotel (usuarios.hotel_id);
//   ignora cualquier valor enviado por el cliente.
// - Dueño: el hotel activo guardado en su sesión, validando en
//   BD que le pertenezca y esté activo (si el superadmin lo
//   desactivó a media sesión, deja de ser accesible).
//
// Todas las consultas de los servicios filtran por este hotelId,
// de modo que un usuario jamás puede leer o modificar recursos de
// otro hotel aunque manipule IDs en las peticiones.
// ============================================================

const { pool } = require('../db/pool');
const { ROLES } = require('../config/constantes');
const { fallo } = require('../utils/respuesta');
const { envolverAsync } = require('./errores');

/** Devuelve los hoteles activos de un dueño. */
async function hotelesDeDueno(duenoId) {
  const [filas] = await pool.query(
    `SELECT id, nombre, direccion, minutos_alerta_limpieza, horas_noche
       FROM hoteles
      WHERE dueno_id = ? AND activo = 1
      ORDER BY nombre`,
    [duenoId]
  );
  return filas;
}

const resolverHotel = envolverAsync(async (req, res, next) => {
  const usuario = req.usuario;

  if (usuario.rol === ROLES.TRABAJADOR) {
    const [filas] = await pool.query(
      `SELECT id, nombre, minutos_alerta_limpieza, horas_noche
         FROM hoteles
        WHERE id = ? AND activo = 1
        LIMIT 1`,
      [usuario.hotel_id]
    );
    if (!filas.length) {
      return fallo(res, 403, 'El hotel asignado no está disponible, comuníquese con el dueño');
    }
    req.hotel = filas[0];
    req.hotelId = filas[0].id;
    return next();
  }

  if (usuario.rol === ROLES.DUENO) {
    const hoteles = await hotelesDeDueno(usuario.id);
    if (!hoteles.length) {
      return fallo(res, 403, 'No tiene hoteles activos asignados, comuníquese con el proveedor');
    }
    // Hotel activo elegido en sesión; si ya no es válido, usar el primero.
    let hotel = hoteles.find((h) => h.id === req.session.hotelActivoId);
    if (!hotel) {
      hotel = hoteles[0];
      req.session.hotelActivoId = hotel.id;
    }
    req.hotel = hotel;
    req.hotelId = hotel.id;
    req.hotelesDueno = hoteles;
    return next();
  }

  // El superadmin no participa en la operación diaria de los hoteles.
  return fallo(res, 403, 'El superadmin no opera hoteles');
});

module.exports = { resolverHotel, hotelesDeDueno };
