# 01 · Arquitectura general

## Visión

AutoHotel SaaS es una aplicación web multi-tenant: **una sola instancia y una sola base de datos** sirven a todos los dueños y sus autohoteles. El aislamiento se garantiza en el servidor, nunca en el cliente.

```
Navegador (HTML/CSS/JS vanilla)
   │  fetch JSON (cookie de sesión)
   ▼
Express (server.js)
   │  1. Cabeceras de seguridad (CSP 'self' — Chart.js vendorizado —,
   │     X-Frame-Options, nosniff, HSTS en producción)
   │  2. express.json (límite 100 kb)
   │  3. express-session + express-mysql-session (tabla `sesiones`,
   │     comparte el pool mysql2 de la aplicación)
   ▼
/api → verificarOrigen (mutantes: mismo origen) → routes/index.js
   │  requiereSesion → requiereRol → resolverHotel (según la ruta)
   ▼
controllers (validación de entrada)
   ▼
services (negocio + SQL parametrizado + transacciones)
   ▼
MySQL/MariaDB (utf8mb4)
```

Resiliencia: `unhandledRejection`/`uncaughtException` se registran con estruendo sin tumbar el proceso (la recepción del hotel no puede caerse por un error asíncrono aislado); en producción además se corre bajo supervisor.

## Organización de carpetas

- `config/` — configuración central (`config.js` lee `.env`) y `constantes.js` (roles, estados, límites, mensajes). Nada de valores mágicos regados por el código.
- `db/` — `pool.js` (mysql2/promise + `conTransaccion`), `schema.sql`, `seed.sql`, `migracion_tarifas.sql`.
- `middleware/` — `auth.js`, `tenant.js`, `seguridad.js` (origen), `errores.js`.
- `controllers/` — pequeños: validan con `utils/validacion` y llaman a un servicio.
- `services/` — toda la lógica de negocio y el único lugar con SQL.
- `utils/` — respuesta estándar, validación, fechas GT, dinero.
- `public/` — frontend completo (3 páginas + 5 JS + 1 CSS).
- `docs/` — esta documentación.

## Flujo de autenticación

1. **Login** (`POST /api/auth/login`, con límite de intentos):
   - Busca el usuario y compara con **bcrypt** (si no existe compara contra un hash de relleno para no delatar usuarios por tiempo de respuesta).
   - Bloqueos, en orden: credenciales → usuario inactivo → suscripción del dueño suspendida o vencida (para trabajadores, la de su dueño) → hotel del trabajador inactivo.
   - `req.session.regenerate()` (anti-fijación) y se guarda solo `usuarioId` (+ `hotelActivoId` para dueños).
   - Respuesta incluye `redirect` (`/superadmin` o `/app`).
2. **Cada petición autenticada** (`requiereSesion`): una consulta recarga usuario + suscripción (`LEFT JOIN suscripciones ON dueno_id = COALESCE(u.dueno_id, u.id)`) y reaplica todas las reglas. Por eso una suspensión o desactivación **expulsa también a las sesiones ya abiertas** en el siguiente request.
3. **Roles** (`requiereRol`): cada grupo de rutas declara qué roles entran.
4. **Logout**: destruye la sesión y limpia la cookie.

## Arquitectura multi-tenant

Jerarquía: **superadmin → dueños → hoteles → trabajadores**.

- El **trabajador** pertenece a UN hotel (`usuarios.hotel_id`). `resolverHotel` usa siempre ese valor; lo que mande el cliente es irrelevante.
- El **dueño** puede tener varios hoteles. Su "hotel activo" vive en la **sesión** (`hotelActivoId`) y se cambia con `POST /api/auth/hotel-activo`, que valida contra `hoteles.dueno_id`. En cada petición `resolverHotel` revalida que el hotel siga siendo suyo y esté activo; si no, usa el primero disponible.
- `resolverHotel` deja en `req.hotelId` y `req.hotel` (con `minutos_alerta_limpieza`, `horas_noche`) el tenant confirmado. **Todos los servicios filtran por ese valor** (`WHERE ... AND hotel_id = ?`), de modo que un recurso ajeno devuelve 404 aunque se manipulen IDs.
- Los módulos que no son por-hotel filtran por dueño (`usuarios` del dueño: `WHERE dueno_id = ?`) o exigen rol superadmin.
- El superadmin **no** pasa por `resolverHotel` (no opera hoteles).

## Manejo de errores

- `ErrorNegocio(mensaje, status)`: errores esperados; su mensaje SÍ llega al usuario.
- Cualquier otro error: se registra completo en el log del servidor y el cliente recibe `500 "Error interno del servidor"`. Los detalles de SQL o stack traces jamás salen.
- `envolverAsync` captura los errores de controladores/middleware async y los envía al manejador central.

## Tiempo real (sin recargar la página)

- `js/app.js` hace **polling cada 25 s** de alertas + sección visible (tablero, dashboard, estancias o limpieza) y se pausa con la pestaña oculta (`document.hidden`).
- Los **contadores** (tiempo transcurrido / restante) se actualizan **cada segundo** en el cliente usando épocas en milisegundos que calcula el backend; `deltaReloj = ahora_epoch_servidor - Date.now()` corrige cualquier desfase del reloj del navegador.
