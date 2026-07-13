# AutoHotel SaaS

Sistema web completo de gestión de **autohoteles** (hoteles de estancia por horas o por noche) para Guatemala, vendido como **servicio por mensualidad (SaaS)** a múltiples dueños. Multi-tenant: 15+ dueños y 15+ autohoteles pueden operar desde el mismo sitio con sus datos completamente aislados.

- Moneda: **Quetzales (Q)** · Zona horaria: **Guatemala (GMT-6)** · Idioma: **español**
- Stack: **Node.js + Express · MySQL/MariaDB (mysql2) · HTML/CSS/JS vanilla · express-session + bcrypt**

---

## Requisitos

| Requisito | Versión |
|---|---|
| Node.js | 18 o superior |
| MySQL / MariaDB | MySQL 5.7+ / MariaDB 10.4+ (XAMPP funciona) |
| npm | 8 o superior |

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
#    (en Windows: copy .env.example .env)
cp .env.example .env
#    Edite .env: credenciales de MySQL y un SESSION_SECRET aleatorio largo

# 3. Importar la base de datos (crea la BD autohotel_saas)
mysql -u root -p < db/schema.sql
mysql -u root -p < db/seed.sql
#    Con XAMPP en Windows:
#    C:\xampp\mysql\bin\mysql.exe -u root < db/schema.sql
#    C:\xampp\mysql\bin\mysql.exe -u root < db/seed.sql

# 4. Iniciar el servidor
npm start
```

Abrir **http://localhost:3000** (el puerto se cambia en `.env`).

> `schema.sql` **borra y recrea** todas las tablas: ejecutarlo de nuevo reinicia el sistema a cero. `seed.sql` carga los datos de prueba.

## Pruebas end-to-end

Con la base recién importada y el servidor corriendo:

```bash
npm test        # ejecuta test/e2e.js: 77 pruebas contra la API real
```

Cubren login por rol, suspensión/vencimiento, cambio de hotel, aislamiento multi-tenant (manipulando IDs, incluidos IDs de tarifas ajenas), **motor de tarifas** (menú por habitación, validaciones del dueño, precio fotografiado que no cambia retroactivamente), flujo completo entrada→cobro→pedido→salida→limpieza, noche completa, horas extra, stock nunca negativo, reservas, cuadre de reportes, usuarios y pagos de mensualidad. Dejan datos de prueba: reimporte `seed.sql` para volver a empezar limpio.

## Usuarios de prueba

| Usuario | Contraseña | Rol | Alcance |
|---|---|---|---|
| `admin` | `admin123` | Superadmin | Todo el sistema (proveedor del software) |
| `carlos` | `dueno123` | Dueño | AutoHotel El Paraíso **y** AutoHotel Luna Azul (2 hoteles) |
| `maria` | `dueno123` | Dueña | AutoHotel Las Palmas |
| `pedro` | `trab123` | Trabajador | AutoHotel El Paraíso |
| `lucia` | `trab123` | Trabajadora | AutoHotel El Paraíso |
| `jorge` | `trab123` | Trabajador | AutoHotel Luna Azul |
| `ana` | `trab123` | Trabajadora | AutoHotel Las Palmas |

Cada hotel se crea con 8 habitaciones, su **menú de tarifas** (paquetes precio/tiempo distintos por hotel: 3/6 h, 3/5 h y 3/4 h), precio de noche, precio de hora extra y 10 productos típicos.

## Qué hace el sistema

### Superadmin (`/superadmin`)
- Lista de dueños con estado de suscripción calculado: **activa / por vencer / vencida / suspendida** y fecha de vencimiento.
- **Registrar pago de mensualidad**: guarda el pago, extiende el vencimiento un mes y reactiva la cuenta.
- Suspender / reactivar dueños manualmente; historial de pagos por dueño.
- Crear y editar dueños; crear hoteles y asignarlos.
- Cuando la fecha de vencimiento pasa sin pago, el login del dueño **y de todos sus trabajadores** queda bloqueado automáticamente con el mensaje *"Servicio suspendido, comuníquese con el proveedor"*.

### Dueño (`/app`)
- **Dashboard**: ingresos del día (habitaciones + pedidos, tomados de los cobros reales), clientes del día, ocupación y alertas activas, con accesos rápidos.
- **Selector de hotel** fijo en la barra superior si tiene más de uno: al cambiarlo, todo el sistema muestra solo ese hotel.
- Todo lo del trabajador, más: **Reportes** (ingresos por día, por habitación, productos más vendidos, listado de estancias — con rango de fechas, filtro por habitación y gráficas Chart.js servido localmente), **Usuarios** (crear/editar/desactivar trabajadores de SUS hoteles) y **Habitaciones y tarifas** (crear/editar habitaciones con su **menú de tarifas precio/tiempo** — ej. Q100/3h, Q160/6h —, precio de noche, precio de hora extra y cambio manual de estado).
- En inventario: control total (editar precios, ajustar stock en ambas direcciones, desactivar productos, auditar el historial de movimientos con usuario y motivo).

### Trabajador (`/app`)
- **Tablero de habitaciones en tiempo real** (polling cada 25 s + contadores en vivo cada segundo): verde = disponible, rojo = ocupada, amarillo = limpieza, morado = reservada. Si está ocupada muestra placa, tiempo transcurrido y hora límite con cuenta regresiva.
- **Registrar entrada**: placa + **tarifa del menú de la habitación** (el paquete elegido dicta precio y duración del contador) o noche completa → calcula salida prevista y manda directo al **cobro** (efectivo con cálculo de cambio, o transferencia). El cobro base es **adelantado**; puede dejarse pendiente y se liquida en la salida. Las condiciones pactadas quedan **fotografiadas** en la estancia: cambios de precios posteriores no la afectan.
- **Pedidos** dentro de la estancia con **buscador instantáneo tipo punto de venta**: teclee y la lista se filtra al momento (ignora mayúsculas y acentos), Enter selecciona, botones +/− para cantidad; descuenta inventario (nunca queda negativo) y acumula al total sin recargar la página.
- **Salida**: desglose habitación + horas extra (si se pasó, redondeadas hacia arriba) + pedidos; cobra lo pendiente y pasa la habitación a LIMPIEZA.
- **Limpieza**: lista con el tiempo transcurrido y botón "Marcar como limpia".
- **Reservas**: crear (habitación queda RESERVADA), convertir en entrada cuando llega el cliente, o cancelar.
- **Inventario**: puede **registrar el ingreso de mercadería** (crear producto nuevo y sumar stock); cada entrada queda auditada con su usuario. No puede editar precios, hacer salidas/ajustes ni desactivar productos, ni ver reportes.

### Alertas automáticas (campana con badge + dashboard)
1. **Tiempo excedido**: estancias activas pasadas de su hora de salida prevista.
2. **Habitaciones sin limpiar**: más de N minutos en limpieza (configurable por hotel, por defecto 30).
3. **Bajo stock**: productos con stock ≤ stock mínimo.

## Estructura del proyecto

```
config/          Configuración (.env) y constantes del dominio
db/              pool mysql2, schema.sql, seed.sql, migracion_tarifas.sql
middleware/      auth (sesión/rol/suspensión), tenant (aislamiento),
                 seguridad (verificación de origen anti-CSRF), errores
services/        Lógica de negocio (transacciones SQL, cálculos de dinero)
controllers/     Validación de entrada y llamadas a servicios
routes/          Definición de rutas + guardas por rol
utils/           Respuesta estándar, validación, fechas GT, dinero
public/          Frontend: login, panel operativo, panel superadmin
public/js/vendor Chart.js vendorizado (sin CDN externo)
docs/            Documentación técnica completa (01–07)
server.js        Punto de entrada Express
```

Documentación ampliada: [ESTRUCTURA.md](ESTRUCTURA.md), [API.md](API.md), [DECISIONES.md](DECISIONES.md) y la carpeta [`/docs`](docs/).

## Seguridad implementada

- Contraseñas con **bcrypt** (10 rondas); jamás en texto plano.
- Sesiones en MySQL (`express-mysql-session`), cookie `httpOnly` + `SameSite=Lax`, regeneración de sesión al iniciar (anti-fijación).
- **Middleware de autenticación + autorización por rol en cada ruta**, y revalidación de suspensión/activo **en cada petición** (una suspensión expulsa también a las sesiones abiertas).
- **Middleware de tenant**: toda consulta operativa filtra por el `hotel_id` resuelto en el servidor; manipular IDs en las peticiones devuelve 404/403 (probado explícitamente).
- Consultas SQL 100 % **parametrizadas**; validación de entradas en backend; los errores internos nunca llegan al cliente.
- Todos los cálculos de dinero se hacen en el **backend**; los montos del frontend son solo informativos. Cada estancia guarda una **foto de las condiciones pactadas** (tarifa y precio de hora extra): cambios de precios jamás alteran cobros en curso o históricos.
- Flujos críticos en **transacciones** con ROLLBACK automático (entrada, cobro, pedido, salida, ajuste de inventario, pago de mensualidad).
- Cabeceras de seguridad (**CSP `script-src 'self'`** — Chart.js vendorizado, sin CDN —, X-Frame-Options, nosniff, HSTS en producción) y límite de intentos de login (10 por 5 minutos).
- **Verificación de origen** en toda petición mutante (`Origin`/`Sec-Fetch-Site`): defensa en profundidad anti-CSRF que complementa `SameSite=Lax`.
- **Resiliencia**: errores asíncronos sin capturar se registran sin tumbar el proceso; el almacén de sesiones comparte el pool de la aplicación (se recupera de reinicios de MySQL).

## Decisiones tomadas

Resumen (detalle completo en [DECISIONES.md](DECISIONES.md) y [docs/06_decisiones.md](docs/06_decisiones.md)):

1. **Libro de cobros (`cobros`)**: cada ingreso real (cobro base y liquidación de salida) se registra con desglose habitación/pedidos; dashboard y reportes salen de ahí, por lo que siempre cuadran con el dinero cobrado.
2. **Fechas en hora de Guatemala (GMT-6)** guardadas como `DATETIME`; el backend calcula "ahora" y lo pasa como parámetro (no depende de la zona horaria del servidor MySQL). GT no tiene horario de verano.
3. **Noche completa**: salida prevista = entrada + `horas_noche` del hotel (por defecto 12, configurable por hotel). Si se excede, las horas extra se cobran a `precio_hora`.
4. **El cobro base puede posponerse** ("Cobrar en la salida"): queda marcado pendiente y se liquida junto con extras y pedidos al finalizar, para no bloquear la operación real.
5. **Trabajador y productos**: puede crear productos indicando el precio de la mercadería recibida (o dejarlo en Q0 para que el dueño lo confirme), pero **no** puede editar precios después.
6. **Reserva ocupa la habitación** (pasa a RESERVADA) hasta que el cliente llega o se cancela, tal como pide la especificación; máx. una reserva pendiente por habitación.
7. **Reactivar manualmente ≠ pagar**: la reactivación manual quita la suspensión, pero si la fecha ya venció el acceso sigue bloqueado hasta registrar un pago (el pago extiende el vencimiento un mes desde el mayor entre hoy y el vencimiento actual).
8. **Cambio manual de estado**: solo `disponible ⇄ limpieza` y liberar una reservada (cancela su reserva). Nunca se puede ocupar/desocupar a mano: eso solo lo hacen la entrada y la salida.
9. **Motor de tarifas por habitación** (tabla `tarifas`): cada habitación ofrece un menú de paquetes precio/tiempo definidos por el dueño (Q100/3h, Q160/6h…). La entrada por tiempo exige elegir una tarifa; el trabajador no puede inventar precios ni duraciones. Instalaciones con datos existentes migran con `db/migracion_tarifas.sql`.
10. **Precio fotografiado en la estancia**: al registrar la entrada se copian tarifa (nombre, horas, precio) y precio de hora extra a la estancia; editar tarifas después no cambia lo pactado con clientes en curso ni la historia.
