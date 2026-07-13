// ============================================================
// Pool de conexiones MySQL (mysql2/promise).
// - dateStrings: los DATETIME viajan como texto plano (hora GT)
//   sin conversiones de zona horaria.
// - decimalNumbers: los DECIMAL llegan como números JS.
// - conTransaccion: helper que garantiza COMMIT/ROLLBACK.
// ============================================================

const mysql = require('mysql2/promise');
const config = require('../config/config');

const pool = mysql.createPool({
  host: config.bd.host,
  port: config.bd.puerto,
  user: config.bd.usuario,
  password: config.bd.password,
  database: config.bd.nombre,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4_unicode_ci',
  // TLS solo si DB_SSL=1 (MySQL administrado); en local queda igual que antes
  ssl: config.bd.ssl
    ? { rejectUnauthorized: true, ...(config.bd.sslCa ? { ca: config.bd.sslCa } : {}) }
    : undefined
});

/**
 * Ejecuta una función dentro de una transacción.
 * Si la función lanza cualquier error se hace ROLLBACK automático
 * y el error se propaga; si termina bien se hace COMMIT.
 */
async function conTransaccion(fn) {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await fn(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    try {
      await conexion.rollback();
    } catch (errorRollback) {
      console.error('Error al hacer ROLLBACK:', errorRollback.message);
    }
    throw error;
  } finally {
    conexion.release();
  }
}

/** Verifica la conexión al iniciar el servidor. */
async function verificarConexion() {
  const conexion = await pool.getConnection();
  await conexion.ping();
  conexion.release();
}

module.exports = { pool, conTransaccion, verificarConexion };
