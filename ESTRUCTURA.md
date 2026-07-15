# Arquitectura del proyecto · AutoHotel SaaS

## Capas

```
Petición HTTP
   │
   ▼
server.js ─ cabeceras de seguridad ─ body parser ─ sesión (MySQL, pool compartido)
   │
   ▼
verificarOrigen          peticiones mutantes: Origin/Sec-Fetch-Site del mismo origen
   │
   ▼
routes/index.js          ¿Qué ruta es y quién puede entrar?
   ├─ requiereSesion     sesión válida + usuario activo + suscripción vigente (cada petición)
   ├─ requiereRol(...)   autorización por rol
   └─ resolverHotel      multi-tenant: fija req.hotelId validado en BD
   │
   ▼
controllers/             Validan TODA la entrada (utils/validacion) y responden
   │                     con el formato estándar { success, message, data }
   ▼
services/                Lógica de negocio: transacciones, cálculos de dinero,
   │                     reglas de estados. Único lugar con SQL.
   ▼
db/pool.js               Pool mysql2 (consultas parametrizadas) + conTransaccion()
```

Errores: los servicios lanzan `ErrorNegocio(mensaje, status)` → `middleware/errores.js` lo convierte en respuesta estándar. Cualquier otro error se registra en el servidor y el cliente solo recibe `"Error interno del servidor"`.

## Carpetas y archivos

| Ruta | Propósito |
|---|---|
| `server.js` | Punto de entrada: Express, sesiones en MySQL, estáticos, rutas, manejador de errores. |
| `config/config.js` | Lee `.env` una sola vez y expone la configuración tipada. |
| `config/constantes.js` | Roles, estados, tipos, límites y mensajes del dominio (único lugar). |
| `db/pool.js` | Pool mysql2 (`dateStrings`, `decimalNumbers`) y helper `conTransaccion` (COMMIT/ROLLBACK automático). |
| `db/schema.sql` | Esquema completo (borra y recrea). |
| `db/seed.sql` | Datos de prueba (usuarios, 3 hoteles, 24 habitaciones, 48 tarifas, 30 productos). |
| `db/migracion_tarifas.sql` | Migración al motor de tarifas para instalaciones con datos previos. |
| `middleware/auth.js` | `requiereSesion` (revalida activo+suscripción), `requiereRol`, limitador de login. |
| `middleware/tenant.js` | `resolverHotel`: hotel del trabajador o hotel activo del dueño, validado en BD. |
| `middleware/seguridad.js` | `verificarOrigen`: rechaza peticiones mutantes de origen cruzado (anti-CSRF). |
| `middleware/errores.js` | `ErrorNegocio`, `envolverAsync`, 404 de API y manejador final. |
| `services/authService.js` | Login (bcrypt + reglas de bloqueo), info de sesión, cambio de hotel activo. |
| `services/habitacionesService.js` | Tablero vivo, CRUD con **menú de tarifas por habitación**, cambio manual de estado, limpieza. |
| `services/estanciasService.js` | Entrada por tarifa o noche (foto de condiciones), cobro base, pre-salida y salida (transacciones + horas extra al precio fotografiado). |
| `services/pedidosService.js` | Pedido transaccional: stock, movimiento, acumulado. |
| `services/productosService.js` | Inventario: crear/editar, entradas de mercadería, ajustes, historial. |
| `services/reservasService.js` | Crear/cancelar reservas y su efecto en la habitación. |
| `services/alertasService.js` | Tiempo excedido, limpieza atrasada, bajo stock. |
| `services/dashboardService.js` | Resumen del día del dueño (desde el libro de cobros). |
| `services/reportesService.js` | Ingresos por día / por habitación, productos vendidos, estancias. |
| `services/usuariosService.js` | Trabajadores del dueño (aislados por `dueno_id`). |
| `services/superadminService.js` | Dueños, hoteles, suscripciones y pagos de mensualidad. |
| `controllers/*.js` | Uno por módulo: validación de entrada + llamada al servicio. |
| `routes/index.js` | Todas las rutas con sus guardas (`operacion`, `soloDueno`, `soloSuperadmin`). |
| `utils/respuesta.js` | `ok()` / `fallo()` → formato estándar de la API. |
| `utils/validacion.js` | Validadores que lanzan `ErrorNegocio` (texto, enteros, montos, ids, usuario, contraseña, mes). |
| `utils/fechas.js` | Hora de Guatemala (GMT-6): ahora, sumas, épocas, horas extra (techo), validación de formatos. |
| `utils/dinero.js` | Redondeo monetario a 2 decimales, multiplicación y suma seguras. |
| `db/importar.js` | Importa schema+seed a la base configurada en `.env` (local o nube, con TLS); exige `--confirmar` porque es destructivo. |
| `services/cajaService.js + controllers/cajaController.js` | Control de caja: abrir/cerrar turno, estado en vivo, historial. Enlaza cada cobro con la caja abierta y bloquea el efectivo del trabajador sin caja. |
| `public/js/caja.js` | Frontend de caja: modal bloqueante de apertura (trabajador), botón/estado en la barra, arqueo de cierre y sección "Cajas" del dueño. |
| `public/index.html + js/login.js` | Pantalla de login. |
| `public/app.html + js/app.js` | Núcleo del panel operativo: sesión, navegación, tablero (con chips de tarifas), dashboard, alertas, polling y contadores. |
| `public/js/operaciones.js` | Entrada con selector de tarifas, cobro, **POS con buscador instantáneo**, salida, limpieza y reservas (modales). |
| `public/js/administracion.js` | Inventario (con buscador), reportes (Chart.js), usuarios y administración de habitaciones con editor de tarifas. |
| `public/js/api.js` | Cliente fetch: formato estándar, expiración de sesión y suspensión. |
| `public/js/comun.js` | Formato Q y fechas, avisos (toast), modales, escape de HTML, normalización de búsquedas. |
| `public/js/vendor/chart.umd.min.js` | Chart.js 4.4.7 vendorizado (CSP `script-src 'self'`, funciona sin internet). |
| `public/js/iconos.js` | Iconografía SVG monocroma (estilo Lucide): helper global `icono(nombre, tam)` usado por todas las plantillas. |
| `public/js/tema.js` | Tema oscuro/claro: aplica el `data-tema` guardado antes del primer pintado y maneja el botón `#boton-tema`. |
| `public/superadmin.html + js/superadmin.js` | Panel del proveedor. |
| `public/css/estilos.css` | Sistema de diseño "SaaS empresarial premium": tokens slate/azul (#0B1120 / #3B82F6), modo claro vía `data-tema="claro"`, tablero por colores de estado, 100 % responsive. |

## Multi-tenant (aislamiento por hotel)

1. Todas las tablas operativas llevan `hotel_id` (habitaciones, estancias, productos, pedidos, movimientos, reservas, cobros).
2. El cliente **nunca** elige el hotel por petición: `resolverHotel` lo fija en el servidor — trabajador → su `usuarios.hotel_id`; dueño → su hotel activo de sesión validado contra `hoteles.dueno_id`.
3. Cada consulta de servicio filtra `AND hotel_id = ?` (o `dueno_id = ?` en usuarios/superadmin). Un ID ajeno simplemente no existe para ese usuario → 404.
4. Jerarquía: superadmin → dueños → hoteles → trabajadores. La suspensión del dueño corta el acceso de toda su jerarquía en el siguiente request.

## Flujo de autenticación

1. `POST /auth/login`: bcrypt.compare (con hash de relleno para igualar tiempos), verifica usuario activo, suscripción del dueño (propia o del dueño del trabajador: ni suspendida ni vencida) y hotel activo del trabajador. Regenera la sesión (anti-fijación) y guarda `usuarioId`.
2. Cada petición: `requiereSesion` recarga usuario + suscripción (1 consulta) y vuelve a aplicar las reglas → los bloqueos surten efecto inmediato.
3. Frontend: `js/api.js` detecta 401 → redirige al login; 403 por suspensión → avisa y cierra.

## Tiempo real

- **Polling** cada 25 s (`app.js`): tablero + alertas + sección activa; se pausa si la pestaña está oculta.
- **Contadores en vivo** cada 1 s con épocas (ms) calculadas por el backend (`ahora_epoch`), de modo que el reloj del navegador no altera los tiempos (`deltaReloj`).

## Dinero

- `DECIMAL(10,2)` en BD; `decimalNumbers: true` en mysql2.
- Todos los cálculos en backend con `utils/dinero.js` (redondeo half-up a 2 decimales).
- Libro `cobros`: única fuente de verdad de ingresos (dashboard y reportes cuadran con lo cobrado).
