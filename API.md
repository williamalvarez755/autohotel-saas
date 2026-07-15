# API REST · AutoHotel SaaS

Base: `http://localhost:3000/api`

## Formato de respuesta (todas las rutas)

```json
{ "success": true,  "message": "", "data": { } }
{ "success": false, "message": "Descripción del error", "data": null }
```

Códigos usados: `200` éxito · `400` validación/regla de negocio · `401` sin sesión · `403` sin permiso o suspendido · `404` recurso inexistente (o de otro hotel) · `429` demasiados intentos de login · `500` error interno (mensaje genérico, sin detalles).

## Autenticación y guardas

- Sesión por cookie `autohotel.sid` (obtenida en el login). Enviar la cookie en cada petición.
- **Roles**: `superadmin`, `dueno`, `trabajador`. Cada grupo de rutas exige un rol.
- **Tenant**: las rutas operativas actúan sobre el hotel resuelto en el servidor (hotel del trabajador o hotel activo del dueño); los IDs de recursos de otro hotel devuelven 404.
- Suspensión/vencimiento del dueño y usuario desactivado se revalidan en **cada** petición.

Leyenda de acceso: **[S]** superadmin · **[D]** dueño · **[T]** trabajador.

---

## Auth

### POST /auth/login — público (rate limit 10/5min)
```json
{ "usuario": "pedro", "password": "trab123" }
```
→ `data`: `{ id, rol, nombre, usuario, redirect, hoteles: [{id, nombre}], hotel_activo_id }`
Errores: credenciales (401) · usuario desactivado (403) · `"Servicio suspendido, comuníquese con el proveedor"` (403).

### POST /auth/logout — cualquiera con sesión
### GET /auth/sesion — [S][D][T] → misma data del login (para restaurar la sesión en el frontend)
### PUT /auth/password — [S][D] — `{ password_actual, password_nueva }`
Cambio de contraseña PROPIA. Exige la contraseña actual (incorrecta → 400) y la nueva de 6–72 caracteres, distinta a la actual. Los trabajadores NO tienen autoservicio (403): su contraseña la administra su dueño vía `PUT /usuarios/:id`.
### POST /auth/hotel-activo — [D]
```json
{ "hotel_id": 2 }
```
Cambia el hotel activo del dueño (valida que le pertenezca y esté activo).

---

## Habitaciones y limpieza

### GET /habitaciones — [D][T]
Tablero: cada habitación con estado, **menú de tarifas** (`tarifas: [{id, nombre, horas, precio}]`), `precio_noche`, `precio_hora_extra`, estancia activa (placa, `tarifa_nombre`, horas, `hora_entrada`, `hora_salida_prevista`, `pagado_base`, totales, épocas en ms para contadores) y reserva pendiente. `data`: `{ habitaciones: [...], ahora_epoch, ahora }`.

### GET /habitaciones/admin — [D] — lista completa (incluye inactivas) con su menú de tarifas.
### POST /habitaciones — [D]
```json
{ "nombre": "H-09", "precio_noche": 200, "precio_hora_extra": 35,
  "tarifas": [ { "nombre": "3 horas", "horas": 3, "precio": 100 },
               { "nombre": "6 horas", "horas": 6, "precio": 160 } ] }
```
El menú de tarifas es obligatorio (1–8 paquetes, nombres únicos, horas 1–24).
### PUT /habitaciones/:id — [D] — mismos campos + `activo`
**Reemplaza el menú de tarifas completo.** Las estancias en curso o históricas no cambian (guardan su foto). No se puede desactivar ocupada ni con reservas pendientes. Nombre único por hotel.
### PUT /habitaciones/:id/estado — [D][T] — `{ "estado": "disponible" | "limpieza" }`
Cambio manual para casos especiales. Bloqueado si hay estancia activa; si estaba reservada, cancela la reserva pendiente.
### GET /limpieza — [D][T] — habitaciones en limpieza con `minutos` y bandera `alerta`.
### POST /habitaciones/:id/limpia — [D][T] — LIMPIEZA → DISPONIBLE.

---

## Estancias (entrada / cobro / salida)

### POST /estancias — [D][T] — registrar entrada
```json
{ "habitacion_id": 1, "placa": "P-123ABC", "tipo": "horas", "tarifa_id": 1 }
{ "habitacion_id": 3, "placa": "P-777XY", "tipo": "noche" }
{ "habitacion_id": 3, "placa": "P-777XY", "tipo": "horas", "tarifa_id": 5, "reserva_id": 5 }
```
Reglas: habitación disponible (o reservada solo con su `reserva_id`). `placa` es **opcional** (clientes que llegan a pie: se guarda vacía). `tipo horas` exige `tarifa_id` **del menú de esa habitación** (una tarifa de otra habitación u otro hotel → 404): la tarifa dicta `total_base` (su precio) y la duración (`hora_salida_prevista = entrada + horas de la tarifa`). `tipo noche`: `total_base = precio_noche`, duración = `horas_noche` del hotel. La estancia **fotografía** `tarifa_nombre`, `precio_hora_extra` y el `cargo_extra` de la reserva (si hubo) — cambios de precios posteriores no la afectan. Habitación → OCUPADA; reserva → usada.
→ `data`: estancia con totales para la pantalla de cobro.

### POST /estancias/:id/pago-base — [D][T] — cobro adelantado
> Control de caja: un **cobro en efectivo hecho por un trabajador** exige que exista una caja **abierta** en su hotel; si no la hay → **409**. El cobro se enlaza a la caja abierta (si existe). El dueño está exento. La transferencia nunca se bloquea.
```json
{ "metodo": "efectivo", "efectivo_recibido": 200 }
{ "metodo": "transferencia" }
```
Valida que no esté pagado; efectivo debe alcanzar. Registra el cobro en el libro `cobros`. → `{ total, metodo, cambio }`.

### GET /estancias/activas — [D][T] — estancias activas con épocas y bandera `excedida`.
### GET /estancias/:id — [D][T] — detalle + pedidos.
### GET /estancias/:id/pre-salida — [D][T] — desglose calculado al momento (no modifica):
`{ total_base, horas_extra, total_extra, total_habitacion, total_pedidos, total_final, pendiente_base, total_pendiente, precio_hora_extra, tarifa_nombre, ... }`
Horas extra = excedente sobre la salida prevista **redondeado hacia arriba**, cobradas al `precio_hora_extra` **fotografiado al registrar la entrada** (no al precio actual de la habitación).

### POST /estancias/:id/salida — [D][T] — finalizar
```json
{ "metodo": "efectivo", "efectivo_recibido": 100 }
```
`metodo` solo es obligatorio si hay pendiente (> Q0). Recalcula extras al momento real, cobra pendiente (base no pagada + extras + pedidos), registra el cobro, estancia → finalizada y habitación → LIMPIEZA. → desglose final + `cambio`.

---

## Pedidos

### GET /estancias/:id/pedidos — [D][T] — pedidos de la estancia + `total_pedidos`.
### POST /estancias/:id/pedidos — [D][T]
```json
{ "producto_id": 3, "cantidad": 2 }
```
Transacción: valida estancia activa y producto activo, **stock nunca negativo** (`"Stock insuficiente de X: quedan N unidades"`), guarda precio unitario del momento, descuenta stock, registra movimiento de inventario y acumula al total. → `{ pedido_id, subtotal, stock_restante, total_pedidos, ... }`.

---

## Inventario

### GET /productos — [D][T] — productos activos (con `bajo_stock`). Dueño: `?todos=1` incluye inactivos.
### POST /productos — [D][T] — crear producto
```json
{ "nombre": "Papitas fritas", "precio": 15, "stock": 30, "stock_minimo": 10 }
```
Trabajador: `precio` opcional (si no lo sabe queda en 0 y el dueño lo confirma). Stock inicial genera movimiento de entrada auditado.
### PUT /productos/:id — [D] — `{ nombre, precio, stock_minimo, activo }` (el stock solo cambia con entradas/ajustes).
### POST /productos/:id/entrada — [D][T] — ingreso de mercadería
```json
{ "cantidad": 24, "motivo": "Llegó camión del proveedor" }
```
### POST /productos/:id/ajuste — [D] — `{ "direccion": "sumar"|"restar", "cantidad": 5, "motivo": "conteo físico" }` (motivo obligatorio; nunca deja stock negativo).
### GET /productos/movimientos — [D] — historial (últimos 300): tipo (entrada/salida/ajustes), cantidad, motivo, **usuario** y fecha. Filtro `?producto_id=`.

---

## Reservas

### GET /reservas — [D][T] — `{ pendientes: [...], historial: [...] }` (incluye `cargo_extra` y `cargo_descripcion`)
### POST /reservas — [D][T]
```json
{ "habitacion_id": 4, "fecha_hora": "2026-07-13 20:00", "placa": "P-9XY", "nota": "Cliente frecuente",
  "cargo_extra": 50, "cargo_descripcion": "Decoración" }
```
Solo habitaciones disponibles; fecha futura. Habitación → RESERVADA. `cargo_extra` (opcional, ≥ 0): recargo por reservar y/o extras solicitados; al convertir la reserva en entrada se FOTOGRAFÍA en la estancia y se cobra junto con la tarifa en el cobro base (la entrada devuelve `total_cobro_base = total_base + cargo_extra`).
### POST /reservas/:id/cancelar — [D][T] — reserva → cancelada, habitación → DISPONIBLE.
Para convertirla en entrada: `POST /estancias` con `reserva_id`.

---

## Control de caja (turnos de efectivo)

Un trabajador abre su caja con un fondo inicial, opera y al cerrar declara el efectivo contado. El sistema calcula el efectivo esperado (fondo + cobros en efectivo enlazados al turno) y el descuadre. Solo puede haber **una caja abierta por hotel** (garantía en BD).

### GET /caja/estado — [D][T] — `{ abierta: {...} | null }`
La caja abierta del hotel con su `efectivo_cobrado` y `efectivo_esperado` calculados en vivo, o `null`.
### POST /caja/abrir — [D][T] — `{ monto_inicial }` — abre la caja (falla si ya hay una abierta).
### POST /caja/cerrar — [D][T] — `{ monto_declarado }`
Cierra la caja abierta: calcula `monto_sistema` (fondo + efectivo del turno) y `descuadre` (`declarado - sistema`: + sobrante / − faltante).
### GET /caja/historial — [D] — turnos del hotel (para auditar descuadres); las cajas abiertas muestran su esperado en vivo.

## Alertas

### GET /alertas — [D][T]
```json
{ "tiempo_excedido": [...], "limpieza_pendiente": [...], "bajo_stock": [...], "total": 3 }
```

---

## Dashboard y reportes (solo dueño)

### GET /dashboard — [D] — ingresos del día (`total/habitaciones/pedidos/cobros`, del libro de cobros), `clientes_dia`, ocupación por estado y alertas.
### GET /reportes/ingresos-dia?desde=2026-07-01&hasta=2026-07-12 — [D]
→ `{ dias: [{dia, habitaciones, pedidos, total, cobros}], totales }`
### GET /reportes/ingresos-habitacion?desde&hasta&habitacion_id — [D]
→ por habitación: estancias, monto habitación, pedidos, total (orden descendente).
### GET /reportes/productos-vendidos?desde&hasta — [D] → unidades y total por producto.
### GET /reportes/estancias?desde&hasta&habitacion_id — [D] → listado para cuadre (máx. 500).
Reglas de rango: formato `AAAA-MM-DD`, `desde ≤ hasta`, máximo 366 días.

---

## Usuarios del dueño

### GET /usuarios — [D] — SUS trabajadores (con hotel). Jamás ve usuarios de otro dueño.
### POST /usuarios — [D] — `{ nombre, usuario, password, hotel_id }` (hotel debe ser suyo; usuario único global; contraseña ≥ 6).
### PUT /usuarios/:id — [D] — `{ nombre, hotel_id, password? }` (password vacío = no cambiar).
### PUT /usuarios/:id/activo — [D] — `{ "activo": 0 | 1 }` (desactivar bloquea su login al instante; no se borra).

---

## Superadmin

### GET /superadmin/duenos — [S]
Cada dueño: datos, suscripción (`suscripcion_estado`, `fecha_vencimiento`), **`estado_calculado`** (`activa | por_vencer | vencida | suspendida`), hoteles y trabajadores activos.
### POST /superadmin/duenos — [S] — `{ nombre, usuario, password, fecha_vencimiento? }` (por defecto: hoy + 1 mes).
### PUT /superadmin/duenos/:id — [S] — `{ nombre, password? }`
### DELETE /superadmin/duenos/:id — [S] — `{ confirmar_usuario }` (el usuario EXACTO del dueño)
Elimina DEFINITIVAMENTE al dueño y toda su jerarquía (hoteles, trabajadores, habitaciones, tarifas, estancias, cobros, reservas, inventario, pagos, suscripción) en una transacción. Rechazado (400) sin confirmación correcta o si hay estancias activas sin liquidar. Pensado para cuentas morosas que quedaron como datos muertos.
### POST /superadmin/duenos/:id/suspender — [S] — bloquea al dueño y a TODOS sus trabajadores (también sesiones abiertas).
### POST /superadmin/duenos/:id/reactivar — [S] — quita la suspensión manual (si está vencida sigue bloqueada hasta pagar).
### POST /superadmin/duenos/:id/pagos — [S]
```json
{ "monto": 500, "mes_correspondiente": "2026-07", "nota": "Pago julio" }
```
Guarda el pago, extiende el vencimiento **un mes** desde `max(hoy, vencimiento actual)` y reactiva la cuenta. → `{ pago_id, nueva_fecha_vencimiento }`.
### GET /superadmin/duenos/:id/pagos — [S] — historial de pagos del dueño.
### POST /superadmin/hoteles — [S] — `{ dueno_id, nombre, direccion, minutos_alerta_limpieza?, horas_noche? }`
### PUT /superadmin/hoteles/:id — [S] — mismos campos + `activo`.
No se puede desactivar un hotel con estancias activas (quedaría dinero sin liquidar): 400 con el conteo de estancias abiertas.

---

## Errores comunes

| Situación | Código | Mensaje |
|---|---|---|
| Sin sesión | 401 | `Debe iniciar sesión` |
| Usuario desactivado | 401/403 | `Usuario desactivado, comuníquese con el administrador` |
| Dueño suspendido o vencido (él o sus trabajadores) | 403 | `Servicio suspendido, comuníquese con el proveedor` |
| Rol sin permiso | 403 | `No tiene permisos para realizar esta acción` |
| Recurso de otro hotel / inexistente | 404 | `... no encontrado/a` |
| Stock insuficiente | 400 | `Stock insuficiente de "X": quedan N unidades` |
| Efectivo insuficiente | 400 | `El efectivo recibido (...) es menor al ...` |
| Habitación no disponible | 400 | `La habitación no está disponible (estado actual: ...)` |
| Tarifa de otra habitación/hotel | 404 | `La tarifa seleccionada no existe para esta habitación` |
| Entrada por horas sin tarifa | 400 | `El identificador "tarifa_id" no es válido` |
| Petición mutante de otro origen | 403 | `Petición de origen cruzado rechazada` |
| Demasiados intentos de login | 429 | `Demasiados intentos fallidos...` |
