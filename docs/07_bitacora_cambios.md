# 07 · Bitácora de cambios

Registro de cambios mayores del sistema. Cada entrada documenta QUÉ cambió, POR QUÉ y qué archivos toca, para que cualquier desarrollador reconstruya el contexto sin leer diffs.

---

## 2026-07-14 · v2.4 — Contraseña propia (superadmin/dueños) + placa opcional

**Suite e2e: 94 → 104 pruebas.**

### Cambio de contraseña propia

`PUT /auth/password` con `{ password_actual, password_nueva }`, solo **superadmin y dueños** (privacidad: nadie más tiene que conocer su clave). Reglas: exige la contraseña actual correcta (400 si no), nueva de 6–72 caracteres y distinta a la actual. Los **trabajadores NO tienen autoservicio** (403): su contraseña la administra únicamente su dueño en la sección Usuarios, como hasta ahora. Frontend: botón de llave en la barra superior (visible para dueño y superadmin; oculto para trabajadores) que abre `modalCambiarPassword()` (nuevo, en `comun.js`, compartido por ambos paneles) con actual/nueva/repetir y validación en cliente + servidor.

### Placa opcional en la entrada

Hay parejas que llegan a pie: `POST /estancias` ya no exige `placa` (`textoOpcional`, se guarda `''`). El formulario dice "(opcional)" y todas las vistas (tablero, estancias, modales de cobro/pedidos/salida, alertas y reporte de estancias) muestran "—" o "sin placa" cuando viene vacía. Sin migración de BD (la columna ya aceptaba cadena vacía).

Archivos: `services/authService.js`, `controllers/{auth,estancias}Controller.js`, `routes/index.js`, `public/{app,superadmin}.html`, `public/js/{comun,iconos,app,operaciones,superadmin,administracion}.js`, `test/e2e.js` (sección M, 10 pruebas nuevas). Verificado en navegador: modal de contraseña en ambos paneles, botón oculto para trabajadores, formulario de entrada con placa opcional.

## 2026-07-14 · v2.3 — Cargo extra en reservas + eliminación definitiva de dueños

Dos peticiones del usuario. **Suite e2e: 77 → 94 pruebas.**

### Cargo extra en reservas (recargo + extras como decoración)

Al crear una reserva (dueño O trabajador) se puede indicar `cargo_extra` (Q, opcional) y `cargo_descripcion` (ej. "decoración"). Reglas de dinero:

- **BD**: `reservas` y `estancias` ganan `cargo_extra DECIMAL(10,2)` y `cargo_descripcion VARCHAR(200)` (migración `db/migracion_cargo_reserva.sql`, aplicada en local y Aiven; schema.sql actualizado).
- El cargo se **FOTOGRAFÍA en la estancia** al convertir la reserva en entrada (mismo principio que las tarifas: editar la reserva o sus precios después jamás altera cobros en curso) y **se cobra junto con el cobro base** (`total = total_base + cargo_extra`); si el base queda pendiente, la salida lo exige completo. `total_final` y el libro de `cobros` lo incluyen (los reportes cuadran).
- **Frontend**: campos en "Crear reserva", columna "Cargo extra" en pendientes, línea de cargo en los modales de reserva/entrada/cobro/estancia/salida y columna "Cargo" en el reporte de estancias.
- **Anti-manipulación**: el cliente NO puede mandar cargo en `POST /estancias`; solo se hereda de la reserva almacenada. Cargo negativo → 400.

### Eliminación definitiva de dueños morosos (superadmin)

`DELETE /superadmin/duenos/:id` con `{ confirmar_usuario }`:

- Purga transaccional en orden de dependencias: cobros → pedidos → movimientos → reservas → estancias → tarifas → productos → habitaciones → trabajadores → pagos_servicio → suscripción → hoteles → dueño.
- Salvaguardas: exige escribir el **usuario exacto** del dueño (400 si no coincide), se niega con **estancias activas** sin liquidar (400), solo rol superadmin (403 al resto). Para impagos temporales sigue existiendo "Suspender".
- **Frontend**: botón "Eliminar" en cada tarjeta de dueño con modal de confirmación que obliga a escribir el usuario; `apiDelete()` nuevo en `api.js`.

Archivos: `db/schema.sql`, `db/migracion_cargo_reserva.sql` (nuevo), `services/{reservas,estancias,habitaciones,reportes,superadmin}Service.js`, `controllers/{reservas,superadmin}Controller.js`, `routes/index.js`, `public/js/{api,operaciones,superadmin,administracion}.js`, `test/e2e.js` (secciones K y L, 17 pruebas nuevas). Verificado además en navegador: flujo completo reserva Q50 decoración → entrada Q150 → cobro con cambio → salida en Q0 → limpieza.

## 2026-07-13 · v2.2 — Preparación para despliegue en la nube

El usuario quería subirlo a InfinityFree para pruebas; se documentó que eso es imposible (InfinityFree es solo PHP, este sistema es Node) y se preparó todo para alternativas reales:

- **TLS opcional hacia MySQL administrado**: `DB_SSL=1` (+ `DB_SSL_CA` opcional con el PEM del proveedor) en `config/config.js` y `db/pool.js`. Sin la variable, el comportamiento local es idéntico al de antes.
- **`db/importar.js` (nuevo, `npm run db:importar -- --confirmar`)**: importa schema+seed a la base configurada en `.env`, quitando `CREATE DATABASE`/`USE` (en MySQL administrado la base ya existe con otro nombre y no hay permiso de crear). Exige `--confirmar` porque hace DROP de todas las tablas. Probado contra una base desechable local: 13 tablas, 7 usuarios.
- **Guía `docs/08_despliegue_nube.md`**: Railway (recomendada), Render+Aiven (gratis permanente) y túnel Cloudflare (demo sin nube), con tablas de variables, importación remota y checklist de seguridad (SESSION_SECRET nuevo, credenciales del seed).
- **Repositorio git inicializado** con `.gitignore` existente (excluye `node_modules/` y `.env`), listo para `git push` a GitHub.

## 2026-07-13 · v2.1 — Rediseño visual "SaaS empresarial premium" (solo estilos e interfaz, cero cambios de lógica)

Reemplazo completo de la identidad visual (antes violeta→fucsia "vibrante") por una estética de SaaS empresarial de lujo estilo Stripe/Linear/Notion. **Ninguna función, endpoint ni flujo cambió**; todos los nombres de clase CSS y los IDs se conservaron, por lo que los JS de lógica no se tocaron salvo en cadenas de presentación.

- **Nueva paleta** (tokens en `:root`): fondo `#0B1120`, paneles `#111827`, tarjetas `#1E293B`, bordes `#334155`, acento primario azul `#3B82F6`, éxito `#22C55E`, advertencia `#F59E0B`, peligro `#EF4444`, texto secundario `#94A3B8`; ámbar reservado para dinero. Sin neones ni gradientes pesados; sombras suaves en 3 niveles, radios 16–20 px, tipografía Inter/Segoe UI Variable con etiquetas uppercase pequeñas y numerales tabulares en montos.
- **Modo claro opcional**: `<html data-tema="claro">` redefine los tokens (fondo `#F8FAFC`, tarjetas blancas, borde `#E5E7EB`). Nuevo `public/js/tema.js` (cargado en `<head>` para evitar parpadeo): botón `#boton-tema` en las barras superiores alterna y persiste en `localStorage`. Las variables legadas (`--verde`, `--rojo`, `--amarillo`, `--morado`, `--azul`, `--acento`) siguen existiendo porque los JS las usan en estilos inline.
- **Iconografía SVG monocroma** (nuevo `public/js/iconos.js`, helper global `icono(nombre, tam)` estilo Lucide, trazo 1.75, `currentColor`): reemplazó TODOS los emojis de la interfaz (navegación, KPI, alertas, botones, estados vacíos, chips de noche, lupa del POS). Las páginas estáticas llevan los SVG inline (logo, campana).
- **Detalles**: logo en tesela azul con edificio, avatar con iniciales (`#avatar-usuario`, calculado en `app.js`), navegación activa con tinta azul + indicador lateral, gráficas de reportes recoloreadas (azul/verde/ámbar/violeta) con ejes que leen los colores del tema activo vía `getComputedStyle`, toasts abajo a la derecha, animación sutil al cambiar de sección, clase `.esqueleto` (shimmer) disponible, `prefers-reduced-motion` respetado.
- **Archivos**: `public/css/estilos.css` (reescrito), `public/js/iconos.js` y `public/js/tema.js` (nuevos), `public/index.html`, `public/app.html`, `public/superadmin.html` (scripts en head, logo/campana/tema/avatar), y solo cadenas de plantilla en `public/js/app.js`, `operaciones.js`, `administracion.js`, `superadmin.js`.
- **Verificado en vivo**: login, dashboard, tablero, modal de entrada, inventario, reportes y superadmin en oscuro y claro, más vista móvil (grid 2 columnas y nav inferior). Consola sin errores; `node --check` en verde para los 9 JS del frontend.

**Iteración 2 (feedback del usuario: barra lateral "pobre" y tablero poco dinámico):**

- **Navegación lateral rediseñada** (252 px, superficie propia `--panel`): enlaces agrupados bajo títulos uppercase — *Panel / Operación / Gestión* (el trabajador ve Operación + Gestión·Inventario) — y **pie fijo con tarjeta del hotel activo** (icono en tesela azul + nombre), que se refresca al cambiar de hotel en el selector (`construirNavegacion()` se rellama en el handler). En móvil los títulos y el pie se ocultan.
- **Tarjetas de habitación v2** (inspiración: referencia enviada por el usuario, adaptada a nuestra identidad): estructura de 3 zonas — `cabecera-hab` con tinte del color de estado (nombre + insignia), `cuerpo-hab` (chips/contador/detalle) y `accion-hab` al pie con la acción según estado ("Registrar entrada", "Gestionar estancia" / "Cobrar y finalizar" si excedida, "Marcar como limpia", "Gestionar reserva") y flecha que se desliza al hover. Grid más grande (minmax 255 px, min-height 180 px).
- **Barra de progreso de tiempo en vivo** en tarjetas ocupadas: `[data-progreso]` con epochs de entrada/salida; `actualizarContadores()` (ticker de 1 s ya existente) le calcula el ancho — azul en curso, roja al exceder. Solo presentación: usa datos que ya venían del backend.
- Archivos: `public/css/estilos.css`, `public/js/app.js` (SECCIONES con `grupo`, construirNavegacion, dibujarTablero, actualizarContadores), `public/js/operaciones.js` (tarjetas de la sección Limpieza), `public/js/iconos.js` (iconos `flecha`, `menos`).
- Verificado en vivo en ambos temas: grupos y pie del sidebar, tarjetas nuevas, cambio de hotel refresca el pie, contadores y barra de progreso funcionando (tarjeta normal y excedida), consola limpia.

---

## 2026-07-13 · Auditoría de seguridad + motor de tarifas + POS + UI premium

Intervención integral en tres fases sobre la base v1.0. **Suite e2e: 63 → 77 pruebas.**

### Fase 1 · Auditoría y endurecimiento de seguridad

Resultado de la auditoría: la base era sólida (SQL 100 % parametrizado, aislamiento multi-tenant resuelto en servidor, XSS cubierto con `escapar()`, sesión regenerada al login, anti-enumeración de usuarios, transacciones con `FOR UPDATE` en flujos de dinero). Hallazgos corregidos:

| # | Hallazgo | Severidad | Corrección |
|---|---|---|---|
| 1 | **Cobro retroactivo de horas extra**: `pre-salida`/`salida` calculaban extras con el `precio_hora` ACTUAL de la habitación (JOIN); editar precios a media estancia cambiaba lo que se le cobra al cliente y la historia | Media (dinero) | Foto de condiciones en `estancias` (`tarifa_nombre`, `precio_hora_extra`); el desglose usa solo la foto. Probado en e2e: se sube el precio a Q999 a media estancia y el cobro no cambia |
| 2 | **CSP dependiente de CDN externo** (`script-src cdn.jsdelivr.net`): un compromiso del CDN ejecuta JS en el panel; sin internet no había gráficas | Media | Chart.js 4.4.7 vendorizado en `public/js/vendor/`; CSP queda `script-src 'self'` + `base-uri`/`form-action 'self'` + HSTS en producción |
| 3 | **CSRF sin defensa en profundidad** (solo `SameSite=Lax` + JSON) | Media | Nuevo `middleware/seguridad.js` (`verificarOrigen`): toda petición mutante exige `Origin`/`Sec-Fetch-Site` del mismo origen, montado en `/api` |
| 4 | **Desactivar hotel con estancias activas** dejaba dinero sin liquidar y clientes "atrapados" | Baja | `superadminService.editarHotel` valida en transacción que no haya estancias activas |
| 5 | **Caída del proceso por error asíncrono**: el limpiador de `express-mysql-session` lanzó `ECONNRESET` sin capturar y tumbó el servidor (reproducido en vivo) | Media (disponibilidad) | El almacén de sesiones comparte el pool mysql2 de la app (se recupera de conexiones muertas); `unhandledRejection`/`uncaughtException` se registran sin tumbar el proceso |
| 6 | Índices subóptimos para el tablero | Baja (rendimiento) | `estancias(habitacion_id, estado)` y `reservas(habitacion_id, estado, fecha_hora)` sirven exactamente el JOIN y la subconsulta del tablero |
| 7 | Rondas bcrypt duplicadas en dos servicios | Baja (mantenibilidad) | Constante única `LIMITES.RONDAS_BCRYPT` |

Archivos: `server.js`, `middleware/seguridad.js` (nuevo), `services/superadminService.js`, `services/usuariosService.js`, `config/constantes.js`, `db/schema.sql` (índices), `public/js/vendor/chart.umd.min.js` (nuevo), `public/app.html`.

### Fase 2a · Motor de tarifas dinámicas

**Regla de negocio nueva**: la relación precio/tiempo es personalizable por hotel y por habitación. Cada habitación ofrece un **menú de tarifas** (ej. "3 horas" Q100, "6 horas" Q160) + precio de noche + precio de hora extra.

- **BD**: tabla `tarifas` (hotel_id, habitacion_id, nombre, horas, precio; única por habitación+nombre; CASCADE con la habitación). `habitaciones`: se elimina `precio_hora`, entra `precio_hora_extra`. `estancias`: entran `tarifa_id` (FK `SET NULL`), `tarifa_nombre` y `precio_hora_extra` (la foto). Seed con 48 tarifas (los 3 hoteles venden duraciones distintas: 3/6 h, 3/5 h, 3/4 h). **`db/migracion_tarifas.sql`** migra instalaciones con datos (hereda `precio_hora`, crea tarifa inicial "3 horas", fotografía estancias históricas).
- **Backend**: `POST /estancias` con `tipo:'horas'` exige `tarifa_id` validada con triple filtro (id + habitación + hotel → ajena = 404, anti-IDOR). La tarifa dicta `total_base` y la duración del contador. `POST/PUT /habitaciones` reciben el menú completo (1–8 tarifas, nombres únicos, horas 1–24) y lo reemplazan en transacción. `GET /habitaciones` y `/habitaciones/admin` devuelven el menú.
- **Frontend**: tablero con chips de tarifas por habitación; modal de entrada con selector de tarjetas de tarifa (+ noche) y total/tiempo/hora-extra en vivo; administración de habitaciones con editor de filas de tarifas (agregar/quitar); todas las pantallas muestran `tarifa_nombre` en lugar de "N h".

### Fase 2b · Buscador rápido de productos (POS)

El modal de pedidos de una estancia es ahora un punto de venta: buscador con **filtrado instantáneo** en cliente (normaliza mayúsculas y acentos — `normalizarBusqueda()` en `comun.js`), lista de productos clicable con precio y stock, Enter selecciona la primera coincidencia, botones +/− de cantidad, subtotal en vivo y stock actualizado sin recargar. El inventario tiene el mismo buscador filtrando la tabla.

Archivos: `public/js/operaciones.js` (modalPedidos reescrito), `public/js/administracion.js` (buscador de inventario), `public/js/comun.js`.

### Fase 3 · Rediseño UI premium

`public/css/estilos.css` reescrito completo conservando todos los nombres de clase (cero cambios rotos en JS):

- Paleta vibrante profesional: base índigo profundo, **gradiente primario violeta→fucsia** (botones, marca, navegación activa), ámbar para dinero, cian de apoyo; estados de habitación con colores semánticos y **brillos** (glow) propios.
- Tarjetas de habitación con barra superior de gradiente por estado, animación de pulso cuando el tiempo está excedido, hover con elevación.
- Login con fondo de brillos animados y tarjeta glass; barra superior con blur; dashboard con chips de icono por tarjeta (`app.js`); modales con animación de entrada y borde luminoso; toasts glass; tablas con hover; scrollbars discretos.
- Gráficas de reportes recoloreadas a la paleta (violeta/cian/ámbar/rosa) con esquinas redondeadas.
- Responsive intacto (navegación inferior en móvil).

### Pruebas (test/e2e.js)

Suite actualizada al flujo de tarifas y ampliada a **77 pruebas**. Nuevas coberturas: menú de tarifas expuesto en el tablero; entrada sin tarifa → 400; **tarifa de otra habitación → 404 (IDOR)**; validaciones del menú (vacío / 0 horas / nombres repetidos → 400); precio fotografiado inmutable ante subida de precios a media estancia; flujo completo de noche (entrada → cobro por transferencia → salida sin pendiente); trabajador no crea habitaciones/tarifas (403); no se puede desactivar hotel con estancias activas.

### Documentación

Actualizados: `README.md`, `ESTRUCTURA.md`, `API.md`, `DECISIONES.md` (decisiones 25–33), `docs/01_arquitectura.md`, `docs/02_base_datos.md`, `docs/03_api.md`, `docs/04_reglas_negocio.md`, `docs/05_despliegue.md`, `docs/06_decisiones.md` y esta bitácora (nueva).

---

## 2026-07-12 · v1.0 — Sistema inicial

Construcción completa del SaaS multi-tenant: superadmin (dueños, hoteles, suscripciones, pagos de mensualidad con bloqueo automático por vencimiento), panel operativo (tablero en tiempo real, entradas por horas/noche, cobro base adelantado con cambio, pedidos con inventario transaccional, salidas con horas extra, limpieza, reservas, alertas), reportes que cuadran con el libro de cobros, usuarios por dueño y 63 pruebas e2e. Detalle en `docs/01–06`.
