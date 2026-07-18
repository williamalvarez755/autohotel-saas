// ============================================================
// Auditoría de acciones administrativas (superadmin y limpiador
// programado). Registra usuario, acción, detalle, IP y fecha.
// NUNCA lanza: un fallo al auditar no debe romper la operación
// (se registra en consola y la operación continúa).
// ============================================================

const { pool } = require('../db/pool');
const { ahoraGT } = require('../utils/fechas');

/**
 * Registra una acción en la auditoría.
 * - usuario: req.usuario (o null para acciones del sistema).
 * - req: la petición (para la IP; null en tareas programadas).
 */
async function registrar(usuario, req, accion, detalle = '') {
  try {
    await pool.query(
      `INSERT INTO auditoria (usuario_id, usuario_nombre, accion, detalle, ip, fecha)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        usuario ? usuario.id : null,
        usuario ? usuario.nombre : 'Sistema (limpieza programada)',
        String(accion).slice(0, 100),
        String(detalle).slice(0, 500),
        req && req.ip ? String(req.ip).slice(0, 45) : '',
        ahoraGT()
      ]
    );
  } catch (error) {
    console.error('No se pudo registrar la auditoría:', error.message);
  }
}

module.exports = { registrar };
