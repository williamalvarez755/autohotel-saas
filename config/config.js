// ============================================================
// Configuración centralizada del sistema.
// Lee las variables de entorno (.env) una sola vez y las expone
// tipadas al resto de la aplicación.
// ============================================================
require('dotenv').config();

function entero(valor, porDefecto) {
  const n = parseInt(valor, 10);
  return Number.isInteger(n) && n > 0 ? n : porDefecto;
}

const config = {
  puerto: entero(process.env.PORT, 3000),
  esProduccion: process.env.NODE_ENV === 'production',

  bd: {
    host: process.env.DB_HOST || '127.0.0.1',
    puerto: entero(process.env.DB_PORT, 3306),
    usuario: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    nombre: process.env.DB_NAME || 'autohotel_saas',
    // TLS para MySQL administrado en la nube (Railway/Aiven/TiDB…):
    // DB_SSL=1 activa la conexión cifrada con verificación de certificado.
    // DB_SSL_CA (opcional): contenido PEM del CA del proveedor, con los
    // saltos de línea escritos como \n (formato habitual en paneles de env).
    ssl: process.env.DB_SSL === '1',
    sslCa: process.env.DB_SSL_CA ? process.env.DB_SSL_CA.replace(/\\n/g, '\n') : ''
  },

  sesion: {
    secreto: process.env.SESSION_SECRET || '',
    horas: entero(process.env.SESSION_HORAS, 12)
  },

  negocio: {
    // Días de anticipación para marcar una suscripción como "por vencer"
    diasPorVencer: entero(process.env.DIAS_POR_VENCER, 5)
  }
};

if (!config.sesion.secreto) {
  throw new Error('Falta SESSION_SECRET en el archivo .env');
}

module.exports = config;
