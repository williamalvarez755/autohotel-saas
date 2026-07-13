# 05 · Despliegue

## Variables de entorno (`.env`)

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | 3000 | Puerto HTTP del servidor |
| `NODE_ENV` | development | `production` activa `trust proxy` y cookies `Secure` |
| `DB_HOST` | 127.0.0.1 | Host de MySQL/MariaDB |
| `DB_PORT` | 3306 | Puerto |
| `DB_USER` | root | Usuario de BD |
| `DB_PASSWORD` | (vacío) | Contraseña de BD |
| `DB_NAME` | autohotel_saas | Nombre de la base |
| `SESSION_SECRET` | — (**obligatoria**) | Cadena aleatoria larga; el servidor no arranca sin ella |
| `SESSION_HORAS` | 12 | Duración de la sesión (se renueva con actividad) |
| `DIAS_POR_VENCER` | 5 | Días de anticipación del estado "por vencer" |

Genere un secreto: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`.

## Instalación local (desarrollo)

```bash
npm install
cp .env.example .env          # editar credenciales
mysql -u root -p < db/schema.sql
mysql -u root -p < db/seed.sql
npm start                     # o npm run dev (reinicio automático)
```

- `schema.sql` **borra y recrea** la base: solo para instalación o reinicio total.
- Los archivos SQL fijan `SET NAMES utf8mb4`, por lo que la importación es segura desde cualquier consola (incluida la de Windows/XAMPP).
- **Actualización desde el esquema anterior (sin tabla `tarifas`)**: NO reimporte `schema.sql` (borraría los datos); con el servidor detenido y respaldo hecho, ejecute `db/migracion_tarifas.sql` una sola vez.

## Producción (Linux + nginx, recomendado)

1. **Base de datos**: cree un usuario dedicado con permisos solo sobre `autohotel_saas`:
   ```sql
   CREATE USER 'autohotel'@'localhost' IDENTIFIED BY 'contraseña-fuerte';
   GRANT SELECT, INSERT, UPDATE, DELETE ON autohotel_saas.* TO 'autohotel'@'localhost';
   ```
   Importe `schema.sql` + `seed.sql` (o solo schema y cree su superadmin con un INSERT del hash bcrypt).
2. **Aplicación**:
   ```bash
   NODE_ENV=production
   # .env con el usuario dedicado y SESSION_SECRET fuerte
   npm ci --omit=dev
   ```
3. **Proceso**: use un supervisor (pm2 o systemd):
   ```bash
   pm2 start server.js --name autohotel && pm2 save
   ```
4. **nginx** como proxy inverso con TLS (la cookie es `Secure` en producción, requiere HTTPS):
   ```nginx
   server {
     listen 443 ssl;
     server_name autohotel.ejemplo.com;
     # ssl_certificate ...; ssl_certificate_key ...;
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_set_header X-Forwarded-Proto $scheme;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header Host $host;
     }
   }
   ```
   `server.js` ya hace `app.set('trust proxy', 1)` en producción.
5. **Zona horaria**: no importa la del servidor — todas las fechas de negocio se calculan en GT (GMT-6) dentro de la aplicación.
6. **Respaldos**: `mysqldump autohotel_saas` diario es suficiente (todo el estado vive en la BD, sesiones incluidas).

## Verificación post-despliegue

1. `GET /` responde el login (200).
2. Login con el superadmin → panel de dueños.
3. Crear un dueño + hotel de prueba, entrar con él y registrar una entrada/salida.
4. Revisar el log del proceso: no debe haber líneas `[ERROR]`.

## Escalado y notas

- **Una instancia** es suficiente para 15+ hoteles (el trabajo es ligero: consultas indexadas + polling cada 25 s).
- Para varias instancias detrás de un balanceador: las sesiones ya están en MySQL (no hay estado en memoria crítico); mueva el rate-limit de login a la BD/Redis si lo necesita estricto entre nodos.
- **Sin dependencias de internet en producción**: Chart.js está vendorizado en `public/js/vendor/` (la CSP solo permite `script-src 'self'`). El sistema completo funciona en una red local sin salida a internet.
- **Resiliencia**: el proceso registra (sin caerse) promesas rechazadas y excepciones no capturadas — p. ej. un reinicio de MySQL a media operación — y el almacén de sesiones comparte el pool de la app, que restablece conexiones muertas solo. Aun así el supervisor (pm2/systemd/NSSM) con reinicio automático es obligatorio en producción.
