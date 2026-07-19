# 07 · Bitácora de cambios

Registro de cambios mayores del sistema. Cada entrada documenta QUÉ cambió, POR QUÉ y qué archivos toca, para que cualquier desarrollador reconstruya el contexto sin leer diffs.

---

## 2026-07-18 · v2.11.1 — Optimización de interfaz para teléfonos

Solo CSS, en un bloque `@media (max-width: 640px)` al final de `estilos.css`: **no alcanza a tablets (≥768px) ni escritorio**, cuyas reglas quedan idénticas (verificado con estilos computados a 961px y 768px).

- **Modales como hoja inferior** (bottom-sheet): pegados abajo, esquinas redondeadas solo arriba, animación de subida, botones del pie a lo ancho en pares de ~44px de alto (objetivo táctil).
- **Sin auto-zoom de iOS**: campos a 16px al enfocar (iOS hace zoom si la fuente es menor).
- **Barra superior compacta**: se oculta el bloque nombre/rol (el avatar conserva las iniciales), selector de hotel más angosto, menos separación.
- **Avisos (toasts) arriba**: abajo viven la navegación fija y el pulgar.
- **POS de pedidos**: productos en 2 columnas, lista más alta (34dvh), botón Agregar a lo ancho.
- Tablas más densas con arrastre suave (`-webkit-overflow-scrolling`), encabezados de sección con botones a lo ancho, tarjetas del tablero más compactas, `env(safe-area-inset-*)` respetado.

Archivo: `public/css/estilos.css`. Verificado en viewport real de 375px (media query activa, sheet abajo, botones 44px) y en 768/961px (sin cambios).

## 2026-07-18 · v2.11 — Respaldos completos del superadmin + revisión de seguridad

**Suite e2e: 219 → 242 pruebas.** Sin cambios de esquema (no requiere migración).

### Módulo "Respaldos" (panel del superadmin)
- **Descargar respaldo completo**: `GET /superadmin/respaldo` exporta las 17 tablas de negocio a un JSON versionado (sesiones fuera). Fechas fieles gracias a `dateStrings`. Auditado con IP.
- **Restaurar desde archivo**: `POST /superadmin/respaldo/restaurar` reemplaza TODOS los datos. Validación estricta (sistema/versión/tablas/columnas contra information_schema — nada del archivo se interpola en SQL; sin superadmin activo → 400), respaldo automático previo a `respaldos/` ("sin respaldo no se restaura"), transacción única con `FOREIGN_KEY_CHECKS=0` (FKs circulares hoteles↔usuarios) siempre restaurado, e **invalidación de todas las sesiones menos la actual** (una sesión vieja podría apuntar a un id que ahora es otro usuario). UI con resumen del archivo (fecha, filas por tabla), checkbox + confirmación textual RESTAURAR.
- **Respaldos guardados en el servidor**: lista y descarga de los automáticos (pre-restauración y limpiezas programadas), con nombre validado anti path-traversal (patrón + resolución dentro de la carpeta).

### Revisión de seguridad (hallazgos y estado)
- **Corregido**: el parser JSON de 50 MB de la restauración corría antes de autenticar → ahora vive DENTRO de la ruta, después del guard de superadmin (un anónimo no puede hacer parsear 50 MB).
- **Corregido**: fechas de archivos de respaldo se mostraban en UTC → ahora en hora GT como el resto del sistema.
- **Verificado sin hallazgos**: regeneración de sesión en el login (anti-fijación), revalidación de usuario/suscripción en cada petición, guards de rol en todas las rutas, SQL 100 % parametrizado (interpolaciones solo de constantes del servidor), verificación de Origin en peticiones mutantes (anti-CSRF), rate limit del login, CSP sin CDNs, `respaldos/` fuera de `public/`.
- **Pruebas nuevas (sección S, 23)**: roles/401/403 en respaldos, CSRF con Origin ajeno → 403, cabeceras de seguridad, tabla/columna desconocida (incluye intento de inyección por nombre de columna) → 400, respaldo sin superadmin → 400, path traversal rechazado, y **round-trip completo**: descargar → crear datos → restaurar → datos revertidos, conteos cuadran, sesión propia sobrevive, las demás se invalidan, el sistema opera y la restauración queda auditada.

Archivos: `services/respaldosService.js` (nuevo), `controllers/respaldosController.js` (nuevo), `routes/index.js`, `server.js`, `public/superadmin.html`, `public/js/{superadmin,superadmin-respaldos}.js`, `test/e2e.js`, docs `04/06`, `API.md` (decisiones 43–44).

## 2026-07-18 · v2.10 — Cobro de consumos en curso (sin esperar la salida)

**Suite e2e: 206 → 219 pruebas.** Pedido por el usuario: "le entrego el producto y de una vez le cobro, no tengo que esperar hasta la salida".

- **BD**: `cobros.tipo` gana el valor **`consumo`**; `estancias.total_pedidos_pagado` marca la porción de pedidos ya cobrada en curso. Migración `db/migracion_cobro_parcial.sql` (aplicada local y Aiven). Seguro por construcción: dashboard, reportes, consultas del superadmin y arqueo de caja suman `cobros` sin filtrar por tipo → el nuevo tipo cuadra en todo sin tocar consultas; las estancias existentes quedan con 0 (su salida liquida todo, igual que antes).
- **Backend**: `POST /estancias/:id/cobro-consumos` (dueño y trabajador) cobra AHORA `pedidos no cobrados + saldo de extras (solo si el base ya se pagó)`; el base nunca entra aquí (tiene `pago-base`). Mismo control de caja (efectivo de trabajador sin caja → 409; se enlaza al turno). Sin nada pendiente → 400. La salida ahora liquida `total_pedidos − total_pedidos_pagado` (no cobra dos veces); si todo se cobró en curso, cierra sin pedir pago. `calcularDesglose` expone `total_pedidos_pagado`/`pedidos_pendientes`; el detalle expone `consumos_pendientes`.
- **Frontend**: modal de estancia con línea "Consumos por cobrar ahora" y botón **"Cobrar consumos"**; el POS de pedidos también tiene el botón (entregar → cobrar en el acto); modal de cobro con método + cambio en vivo; la salida marca "Pedidos · ya cobrado Q…".
- Archivos: `db/{schema,migracion_cobro_parcial}.sql`, `config/constantes.js`, `services/estanciasService.js`, `controllers/estanciasController.js`, `routes/index.js`, `public/js/operaciones.js`, `test/e2e.js` (sección R, 13 pruebas), docs `02/04/06`, `API.md` (decisión 42).

## 2026-07-18 · v2.9 — Baja de inventario por trabajadores + extras con la estancia en curso

**Suite e2e: 188 → 206 pruebas.** Regla cero respetada: no hay rutas nuevas de dinero y la caja no se toca (los ajustes de inventario no involucran transacciones monetarias).

### Baja de inventario / consumo interno (trabajador con justificación)
`POST /productos/:id/ajuste` pasa de `soloDueno` a `operacion`: el trabajador ahora ajusta stock (sumar/restar) igual que el dueño, **siempre con justificación obligatoria** (`motivo`, ya validado con `textoRequerido`). No se creó tabla nueva: cada ajuste ya queda auditado en **`movimientos_inventario`** con producto, cantidad, tipo (`ajuste_positivo/negativo`), justificación exacta, usuario y fecha GT. El stock jamás queda negativo (transacción + `FOR UPDATE`). El historial de movimientos sigue siendo **solo del dueño**. UI: botón "Ajustar" visible para ambos roles con nota "quedará registrado con su usuario… no afecta la caja".

### Extras agregados con la estancia en curso (incluso ya pagado el base)
Antes los extras (jacuzzi, decoración) solo se elegían al registrar la entrada. Ahora también se agregan DESPUÉS con `POST /estancias/:id/extras` (dueño y trabajador):

- **BD**: `estancias.cargo_extra_pagado` (migración `db/migracion_extras_postpago.sql`, aplicada en local y Aiven) — foto de cuánto del cargo adicional quedó saldado al pagar el base (`pagarBase` lo fija = `cargo_extra`).
- **Regla**: si el base NO se ha pagado, el extra engrosa el cobro base (tubería intacta). Si YA se pagó, la diferencia `cargo_extra − cargo_extra_pagado` queda como **saldo pendiente** que la salida liquida por la tubería de cobros existente (respetando el control de caja del trabajador). Anti-IDOR (extra de otra habitación → 404), duplicado → 409, estancia finalizada → 400, tope de descripción 200.
- **Frontend**: el modal de estancia muestra "Saldo de extras por cobrar en la salida" y el botón "Agregar extra" (lista vertical con los extras de la habitación; los ya agregados aparecen deshabilitados). La pre-salida marca el cargo como "pendiente Q…" en vez de "ya pagado" cuando hay saldo.
- **Fix de paso**: al registrar un pedido, `total_final` en curso omitía `cargo_extra` (se corregía recién al finalizar); la fórmula ahora incluye los tres conceptos.

Archivos: `db/{schema,migracion_extras_postpago}.sql`, `services/{estancias,productos,pedidos}Service.js`, `controllers/{estancias,productos}Controller.js`, `routes/index.js`, `public/js/{operaciones,administracion}.js`, `public/css/estilos.css`, `test/e2e.js` (sección Q, 18 pruebas + 1 actualizada), docs `02/04/06`, `API.md`.

## 2026-07-18 · v2.8 — Módulo Gastos + extras opcionales por habitación

**Suite e2e: 171 → 188 pruebas.**

### Sección "Gastos" (grupo Gestión)
Nueva sección en el panel operativo (dueño y trabajador): registrar gastos del turno (mismo `modalRetiro` con nota automática) y ver la tabla de retiros de la caja abierta. El dueño además tiene el **historial completo de gastos** con rango de fechas y total (excluye retiros de cierre) — `GET /caja/gastos` (solo dueño).

### Extras opcionales por habitación (ej. jacuzzi +Q40)
El dueño elige QUÉ habitaciones ofrecen extras y su precio; el recepcionista los activa con botones al registrar la entrada.

- **BD**: tabla `extras_habitacion` (mismo patrón que `tarifas`: única por habitación+nombre, CASCADE, reemplazo total en transacción). Migración `db/migracion_extras.sql` aplicada en local y Aiven; seed con jacuzzis en superiores/suites.
- **Backend**: `POST/PUT /habitaciones` aceptan `extras` (0–8, nombre único, precio > 0); tablero y admin los exponen por habitación. `POST /estancias` acepta `extras: [ids]` con validación anti-IDOR (extra de otra habitación → 404); la suma y los nombres se **pliegan en `cargo_extra`/`cargo_descripcion`** (foto) — así reutilizan TODA la tubería de dinero existente (cobro base, desglose, salida, cobros, reportes) sin rutas nuevas de dinero.
- **Frontend**: chips "＋ Jacuzzi Q40" en la tarjeta disponible; en la entrada, sección "Extras opcionales" con botones de **selección múltiple** (prender/apagar) y línea de desglose + total en vivo (verificado: Q125 + Jacuzzi = Q165). Editor de extras en la administración de habitaciones (igual al de tarifas, puede quedar vacío). Etiqueta "Cargo de reserva" → "Cargos adicionales" en cobro/estancia/salida (ahora puede incluir extras).
- **Fix de paso**: la purga de dueños (`eliminarDueno`) no borraba `turnos_caja`/`retiros_caja` (FK habría fallado con historial de cajas); corregido.

Archivos: `db/{schema,seed,migracion_extras}.sql`, `config/constantes.js`, `services/{habitaciones,estancias,caja,superadmin}Service.js`, `controllers/{habitaciones,estancias,caja}Controller.js`, `routes/index.js`, `public/app.html`, `public/js/{app,caja,operaciones,administracion}.js`, `public/css/estilos.css`, `test/e2e.js` (sección P, 17 pruebas). Verificado en navegador: sección Gastos completa (abrir caja → gasto Q45 con nota → historial), toggle de jacuzzi en entrada con desglose, editor del dueño con los extras de Suite 1.

## 2026-07-18 · v2.7 — Retiros de caja, gastos operativos y notas automáticas

**Suite e2e: 150 → 171 pruebas.** Completa el módulo de caja (v2.5) con la parte de gastos. Regla cero respetada: la fórmula anterior solo se EXTIENDE (antes no existían retiros, así que los cierres viejos no cambian de significado).

- **BD**: nueva tabla `retiros_caja` (hotel_id, turno_id FK, usuario_id, tipo `gasto|cierre`, monto, justificacion, **nota** inmutable, fecha). Migración `db/migracion_retiros_caja.sql` aplicada en local y Aiven.
- **Retiros compartidos**: dueño Y trabajador retiran de la caja activa (`POST /caja/retiros`); exige justificación y que el monto no exceda el disponible (validado con `FOR UPDATE` en transacción). Sin caja → 409.
- **Notas automáticas** (formato ESTRICTO, generado en backend con fecha GT): `DD-MM-YYYY se retira [monto] para [justificación]` (monto sin símbolo, entero o con 2 decimales) y al cierre `DD-MM-YYYY se retira efectivo del hotel` (tipo `cierre`, fuera de la fórmula).
- **Fórmula del arqueo actualizada**: `esperado = monto_inicial + ventas en efectivo − retiros/gastos`; `descuadre = declarado − esperado`.
- **Cierre flexible**: también lo hace el dueño (sin logout; el trabajador sí cierra sesión). Checkbox "retirar el efectivo" genera la nota de cierre.
- **Frontend**: el dueño ahora ve y opera la caja desde la barra (abrir/retirar/cerrar, sin modal forzado ni bloqueo); modal de caja con fórmula desglosada y notas del turno; modal de retiro con **vista previa en vivo de la nota**; historial "Cajas" del dueño con columna Retiros y modal "Notas (n)" por turno.
- Archivos: `db/schema.sql`, `db/migracion_retiros_caja.sql` (nuevo), `services/cajaService.js`, `controllers/cajaController.js`, `routes/index.js`, `public/js/{caja,app,operaciones}.js`, `test/e2e.js` (sección O, 21 pruebas), docs `02/04/06`.
- Verificado en navegador (como dueño): abrir Q500 → retiro Q100 con nota "17-07-2026 se retira 100 para desayuno trabajadores" → esperado Q400 → cierre cuadrado con nota de cierre → historial con "Notas (2)". Consola limpia.

## 2026-07-17 · v2.6 — Ampliación del panel Super Admin

**Suite e2e: 120 → 150 pruebas.** Cero cambios de comportamiento en lo anterior. El panel del superadmin pasó de una sola vista a un panel multi-módulo (nav lateral igual que el operativo).

Adaptaciones honestas al dominio real (documentadas): el sistema **no guarda identidad de huéspedes** (privacidad del autohotel) — el "cliente" se identifica por **placa**, así que las consultas de cliente buscan por placa. "Facturas/consumos" = tablas `cobros`/`pedidos`. No existe estado "mantenimiento" de habitación; se ofrecen los estados reales (disponible/ocupada/limpieza/reservada).

### 1) Propietarios (ficha completa)
`usuarios` gana DPI, NIT, teléfono, correo, dirección, observaciones y `ultimo_acceso` (migración `db/migracion_superadmin.sql`). Crear/editar propietario con toda la ficha (correo validado), vista "Ver" de solo lectura, búsqueda en vivo por nombre/usuario/correo/teléfono/DPI/NIT, conteo de hoteles. El login guarda `ultimo_acceso`.

### 2) Administración de hoteles
`DELETE /superadmin/hoteles/:id`: elimina físicamente **solo** si no hay procesos críticos (estancias activas/ocupadas, reservas pendientes, caja abierta, trabajadores) ni historial; si hay historial se rechaza y la UI ofrece la **desactivación lógica**. No afecta a los demás hoteles del dueño. Confirmación por texto "ELIMINAR".

### 3) Consultas avanzadas
`services/consultasService.js`: catálogo de 12 consultas **parametrizadas** (SQL fijo, jamás del cliente) — clientes, reservas, ventas (día/mes/año/método), habitaciones, inventario (bajo/top/sin movimiento), usuarios, auditoría. Filtros dinámicos (fechas, hotel, estado, búsqueda). Tabla reutilizable `reportes-tabla.js` con búsqueda en vivo, orden por columna y exportación **Excel (CSV UTF-8), PDF e Imprimir** (vía diálogo del navegador; sin librerías por la CSP `script-src 'self'`).

### 4) Limpieza de datos históricos
`services/limpiezaService.js`: por tipo (estancias+pedidos+cobros, reservas, movimientos, turnos de caja, auditoría, sesiones) anteriores a una fecha. Flujo seguro: **resumen** (conteos) → **respaldo** descargable (JSON) → **doble confirmación** (checkbox + escribir ELIMINAR) → borrado transaccional → **auditoría**.

### 5) Políticas de retención
Tabla `politicas_retencion` (meses + frecuencia). El servidor corre un ciclo cada 6 h que ejecuta las políticas no manuales (mensual/trimestral/anual) con **respaldo automático** a `respaldos/` antes de borrar.

### 6) Seguridad y auditoría
Todo bajo `soloSuperadmin`. Nuevo `services/auditoriaService.js`: cada acción administrativa (crear/editar/eliminar/suspender dueño, pagos, hoteles, limpieza, retención) registra usuario, acción, detalle, **IP** y fecha. La auditoría es consultable desde Consultas.

Archivos: `db/schema.sql`, `db/migracion_superadmin.sql` (nuevo, aplicado en local y Aiven), `db/seed.sql` (ficha de dueños), `config/constantes.js` no; `services/{auditoria,consultas,limpieza}Service.js` (nuevos), `services/{superadmin,auth}Service.js`, `controllers/{superadmin,consultas}Controller.js`, `routes/index.js`, `server.js` (ciclo de retención), `public/superadmin.html`, `public/js/{superadmin,superadmin-consultas,superadmin-limpieza,reportes-tabla,iconos}.js`, `public/css/estilos.css` (barra de reportes, consultas, impresión), `test/e2e.js` (sección Ñ, 30 pruebas). Verificado en navegador: 4 módulos, ficha, búsqueda, consultas con orden/búsqueda/CSV, limpieza con doble confirmación, retención editable, responsive, sin errores de consola.

## 2026-07-15 · v2.5 — Módulo de Control de Caja + selector vehículo/peatón

**Suite e2e: 104 → 120 pruebas.** Ninguna función previa cambió su comportamiento (dueños y superadmin siguen igual).

### Control de caja (turnos de efectivo físico)

Los trabajadores gestionan el "sencillo" con apertura/cierre de caja por turno.

- **BD**: nueva tabla `turnos_caja` (id, hotel_id, usuario_id, monto_inicial, fecha_apertura/cierre, monto_sistema, monto_declarado, descuadre, estado, cerrado_por) + columna `hotel_abierta` con índice **UNIQUE** que garantiza **una sola caja abierta por hotel** a nivel de motor. `cobros` gana `turno_id` (FK, `ON DELETE SET NULL`) para enlazar cada cobro con su turno. Migración `db/migracion_caja.sql` (aplicada en local; **Aiven pendiente**, ver nota).
- **Relación**: se eligió `cobros.turno_id` (no timestamps) — robusto y multi-tenant. `monto_sistema = fondo + Σ(cobros efectivo del turno)`. La transferencia no cuenta para el efectivo.
- **Backend** (`services/cajaService.js`, `controllers/cajaController.js`, rutas `/caja/*`): estado en vivo, abrir (revalida en transacción + índice UNIQUE), cerrar (arqueo y descuadre), historial (solo dueño). En `estanciasService` (`pagarBase`/`finalizar`) se agregó el bloqueo: **un cobro en efectivo de un TRABAJADOR exige caja abierta (409)**; el dueño está exento; cualquier cobro se enlaza a la caja abierta si existe. Se pasa `req.usuario` (id+rol) a ambos servicios.
- **Frontend** (`public/js/caja.js`): al entrar sin caja, modal bloqueante que exige el fondo (solo limpieza queda disponible; `requiereCaja()` gatea entrada/salida/tablero). Botón "Caja: Q…" en la barra con el efectivo esperado en vivo; modal de turno y arqueo de cierre con vista previa del descuadre (faltante/cuadra/sobrante) que al confirmar cierra la sesión. Sección "Cajas" del dueño con el historial y el arqueo coloreado.

### Selector "Con vehículo / A pie" en la entrada

En el modal de entrada, un selector decide si se pide la placa: "Con vehículo" muestra el campo, "A pie" lo oculta y envía placa vacía (parejas que llegan caminando). Puramente de presentación sobre la placa ya opcional de v2.4.

Archivos: `db/schema.sql`, `db/migracion_caja.sql` (nuevo), `config/constantes.js`, `services/{caja,estancias}Service.js`, `controllers/{caja,estancias}Controller.js`, `routes/index.js`, `public/app.html`, `public/js/{caja,app,operaciones,iconos}.js`, `test/e2e.js` (bloqueo+apertura en sección C y sección N completa, 16 pruebas nuevas). Verificado en navegador: modal bloqueante, apertura, cobro que sube el esperado, toggle vehículo/pie, arqueo con descuadre, cierre con logout e historial del dueño (Faltante Q20).

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
