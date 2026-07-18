// ============================================================
// AutoHotel SaaS - Servidor Express
// Punto de entrada: sesiones en MySQL, cabeceras de seguridad,
// archivos estáticos del frontend y la API REST en /api.
// ============================================================

const path = require('path');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const config = require('./config/config');
const { pool, verificarConexion } = require('./db/pool');
const rutasApi = require('./routes/index');
const { rutaNoEncontrada, manejadorErrores } = require('./middleware/errores');
const { verificarOrigen } = require('./middleware/seguridad');

// ---------------- Red de seguridad del proceso ----------------
// Un error asíncrono sin capturar (p. ej. un ECONNRESET del limpiador
// interno del almacén de sesiones si MySQL se reinicia) NO debe tumbar
// la recepción del hotel: se registra con estruendo y se sigue operando.
// En producción igual debe correrse bajo un supervisor (PM2/NSSM).
process.on('unhandledRejection', (razon) => {
  console.error('[CRÍTICO evitado] Promesa rechazada sin capturar:', razon);
});
process.on('uncaughtException', (error) => {
  console.error('[CRÍTICO evitado] Excepción no capturada:', error);
});

const app = express();

// Detrás de un proxy inverso (nginx) en producción
if (config.esProduccion) {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');

// ---------------- Cabeceras de seguridad ----------------
// Chart.js está vendorizado en /js/vendor, por lo que la CSP solo
// permite scripts del propio servidor (sin CDNs de terceros).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (config.esProduccion) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// ---------------- Body parser ----------------
app.use(express.json({ limit: '100kb' }));

// ---------------- Sesiones almacenadas en MySQL ----------------
// Reutiliza el pool de la aplicación: menos conexiones abiertas y el
// pool se recupera solo de conexiones muertas (reinicios de MySQL).
const almacenSesiones = new MySQLStore(
  {
    createDatabaseTable: true,
    schema: {
      tableName: 'sesiones',
      columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' }
    }
  },
  pool
);

app.use(
  session({
    name: 'autohotel.sid',
    secret: config.sesion.secreto,
    store: almacenSesiones,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.esProduccion,
      maxAge: config.sesion.horas * 60 * 60 * 1000
    }
  })
);

// ---------------- API REST ----------------
app.use('/api', verificarOrigen, rutasApi);
app.use('/api', rutaNoEncontrada);

// ---------------- Frontend estático ----------------
const carpetaPublica = path.join(__dirname, 'public');
app.use(express.static(carpetaPublica, {
  index: 'index.html',
  setHeaders(res, ruta) {
    // Las vistas HTML no se cachean para recibir siempre la última versión
    if (ruta.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
}));

// Rutas de las vistas principales
app.get('/app', (req, res) => res.sendFile(path.join(carpetaPublica, 'app.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(carpetaPublica, 'superadmin.html')));

// Cualquier otra ruta vuelve al login
app.use((req, res) => res.redirect('/'));

// Manejador final de errores (después de todo)
app.use(manejadorErrores);

// ---------------- Limpieza programada (políticas de retención) ----------------
// Revisa cada 6 horas si alguna política programada (mensual /
// trimestral / anual) ya cumplió su frecuencia y la ejecuta con
// respaldo previo. Los errores se registran sin tumbar el proceso.
const limpiezaService = require('./services/limpiezaService');
const SEIS_HORAS_MS = 6 * 60 * 60 * 1000;

function programarLimpieza() {
  const correr = () => {
    limpiezaService.cicloProgramado().catch((error) => {
      console.error('Limpieza programada: error en el ciclo:', error.message);
    });
  };
  setTimeout(correr, 60 * 1000); // primer chequeo al minuto de arrancar
  setInterval(correr, SEIS_HORAS_MS);
}

// ---------------- Arranque ----------------
async function iniciar() {
  try {
    await verificarConexion();
    app.listen(config.puerto, () => {
      console.log(`AutoHotel SaaS escuchando en http://localhost:${config.puerto}`);
    });
    programarLimpieza();
  } catch (error) {
    console.error('No se pudo conectar a la base de datos:', error.message);
    console.error('Verifique la configuración del archivo .env y que MySQL esté corriendo.');
    process.exit(1);
  }
}

iniciar();
