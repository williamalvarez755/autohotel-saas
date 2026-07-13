// ============================================================
// Importador de schema.sql + seed.sql hacia la base configurada
// en .env (local o MySQL administrado en la nube).
//
// Uso:  node db/importar.js --confirmar
//       npm run db:importar -- --confirmar
//
// - Omite CREATE DATABASE / USE del schema: en MySQL administrado
//   (Railway, Aiven, TiDB…) la base ya existe con otro nombre y no
//   hay permiso para crear bases; se usa DB_NAME tal cual.
// - ¡DESTRUCTIVO!: borra y recrea todas las tablas (DROP TABLE),
//   por eso exige el argumento --confirmar.
// ============================================================

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../config/config');

function limpiarSql(sql) {
  return sql
    .replace(/CREATE DATABASE[\s\S]*?;/gi, '')
    .replace(/^\s*USE\s+[^;]+;/gim, '');
}

async function importar() {
  if (!process.argv.includes('--confirmar')) {
    console.log('Este script BORRA y recrea todas las tablas de la base:');
    console.log(`  ${config.bd.usuario}@${config.bd.host}:${config.bd.puerto}/${config.bd.nombre}`);
    console.log('Si está seguro, ejecútelo con:  npm run db:importar -- --confirmar');
    process.exit(1);
  }

  const schema = limpiarSql(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  const seed = limpiarSql(fs.readFileSync(path.join(__dirname, 'seed.sql'), 'utf8'));

  const conexion = await mysql.createConnection({
    host: config.bd.host,
    port: config.bd.puerto,
    user: config.bd.usuario,
    password: config.bd.password,
    database: config.bd.nombre,
    multipleStatements: true,
    charset: 'utf8mb4_unicode_ci',
    ssl: config.bd.ssl
      ? { rejectUnauthorized: true, ...(config.bd.sslCa ? { ca: config.bd.sslCa } : {}) }
      : undefined
  });

  try {
    console.log(`Importando schema en ${config.bd.host}:${config.bd.puerto}/${config.bd.nombre} …`);
    await conexion.query(schema);
    console.log('Schema creado. Importando datos de prueba (seed) …');
    await conexion.query(seed);

    const [tablas] = await conexion.query('SHOW TABLES');
    const [usuarios] = await conexion.query('SELECT COUNT(*) AS n FROM usuarios');
    console.log(`Listo: ${tablas.length} tablas, ${usuarios[0].n} usuarios de prueba.`);
    console.log('Credenciales de prueba: admin/admin123 · carlos/dueno123 · pedro/trab123');
  } finally {
    await conexion.end();
  }
}

importar().catch((error) => {
  console.error('Error al importar:', error.message);
  process.exit(1);
});
