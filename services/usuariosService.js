// ============================================================
// Servicio de usuarios del dueño: gestión de SUS trabajadores.
// Toda consulta filtra por dueno_id = id del dueño autenticado,
// por lo que un dueño jamás puede ver ni tocar usuarios de otro.
// ============================================================

const bcrypt = require('bcrypt');
const { pool, conTransaccion } = require('../db/pool');
const { LIMITES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT } = require('../utils/fechas');

const RONDAS_BCRYPT = LIMITES.RONDAS_BCRYPT;

/** Trabajadores del dueño con el hotel al que pertenecen. */
async function listar(duenoId) {
  const [filas] = await pool.query(
    `SELECT u.id, u.nombre, u.usuario, u.rol, u.activo, u.creado_en,
            h.id AS hotel_id, h.nombre AS hotel_nombre
       FROM usuarios u
       JOIN hoteles h ON h.id = u.hotel_id
      WHERE u.dueno_id = ? AND u.rol = 'trabajador'
      ORDER BY h.nombre, u.nombre`,
    [duenoId]
  );
  return filas;
}

/** Valida que un hotel pertenezca al dueño y esté activo. */
async function validarHotelDelDueno(cx, duenoId, hotelId) {
  const [filas] = await cx.query(
    'SELECT id FROM hoteles WHERE id = ? AND dueno_id = ? AND activo = 1 LIMIT 1',
    [hotelId, duenoId]
  );
  if (!filas.length) {
    throw new ErrorNegocio('El hotel indicado no le pertenece o no está activo', 403);
  }
}

/** Crea un trabajador asignado a uno de los hoteles del dueño. */
async function crear(duenoId, datos) {
  return conTransaccion(async (cx) => {
    await validarHotelDelDueno(cx, duenoId, datos.hotel_id);

    const [existe] = await cx.query(
      'SELECT id FROM usuarios WHERE usuario = ? LIMIT 1',
      [datos.usuario]
    );
    if (existe.length) throw new ErrorNegocio('El nombre de usuario ya está en uso');

    const hash = await bcrypt.hash(datos.password, RONDAS_BCRYPT);
    const [resultado] = await cx.query(
      `INSERT INTO usuarios (rol, nombre, usuario, password_hash, dueno_id, hotel_id, activo, creado_en)
       VALUES ('trabajador', ?, ?, ?, ?, ?, 1, ?)`,
      [datos.nombre, datos.usuario, hash, duenoId, datos.hotel_id, ahoraGT()]
    );
    return { id: resultado.insertId };
  });
}

/** Edita un trabajador del dueño (nombre, hotel y contraseña opcional). */
async function editar(duenoId, trabajadorId, datos) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      `SELECT id FROM usuarios
        WHERE id = ? AND dueno_id = ? AND rol = 'trabajador'
        LIMIT 1 FOR UPDATE`,
      [trabajadorId, duenoId]
    );
    if (!filas.length) throw new ErrorNegocio('Trabajador no encontrado', 404);

    await validarHotelDelDueno(cx, duenoId, datos.hotel_id);

    if (datos.password) {
      const hash = await bcrypt.hash(datos.password, RONDAS_BCRYPT);
      await cx.query(
        'UPDATE usuarios SET nombre = ?, hotel_id = ?, password_hash = ? WHERE id = ?',
        [datos.nombre, datos.hotel_id, hash, trabajadorId]
      );
    } else {
      await cx.query(
        'UPDATE usuarios SET nombre = ?, hotel_id = ? WHERE id = ?',
        [datos.nombre, datos.hotel_id, trabajadorId]
      );
    }
    return { id: trabajadorId };
  });
}

/** Activa o desactiva un trabajador (no se borra: queda auditable). */
async function cambiarActivo(duenoId, trabajadorId, activo) {
  const [resultado] = await pool.query(
    `UPDATE usuarios SET activo = ?
      WHERE id = ? AND dueno_id = ? AND rol = 'trabajador'`,
    [activo, trabajadorId, duenoId]
  );
  if (!resultado.affectedRows) throw new ErrorNegocio('Trabajador no encontrado', 404);
  return { id: trabajadorId, activo };
}

module.exports = { listar, crear, editar, cambiarActivo };
