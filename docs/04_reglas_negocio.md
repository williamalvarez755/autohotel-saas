# 04 · Reglas de negocio

## Flujo de estados de habitación

```
                 (entrada)                (salida)
 DISPONIBLE ───────────────► OCUPADA ───────────────► LIMPIEZA
     ▲  │                                                 │
     │  │ (crear reserva)              (marcar limpia)    │
     │  ▼                                                 │
 RESERVADA ── (llega el cliente: entrada con reserva) ──► OCUPADA
     │                                                    
     └── (cancelar reserva) ──► DISPONIBLE                
```

- **Manual** (casos especiales): solo `disponible ⇄ limpieza`; liberar una `reservada` cancela su reserva pendiente. Jamás se puede poner `ocupada` a mano ni sacar de `ocupada` sin finalizar la estancia (protege el dinero).
- Desactivar una habitación exige que no esté ocupada ni tenga reservas pendientes.
- Desactivar un **hotel** (superadmin) exige que no tenga estancias activas (quedaría dinero sin liquidar).
- Colores en la interfaz: disponible **verde**, ocupada **rojo**, limpieza **amarillo**, reservada **morado**.

## Motor de tarifas (precio/tiempo por habitación)

- Cada habitación define su **menú de tarifas**: paquetes `{nombre, horas, precio}` creados por el dueño (ej. "3 horas" = Q100, "6 horas" = Q160). Mínimo 1 y máximo 8 por habitación; nombres únicos; horas 1–24.
- Además la habitación tiene `precio_noche` (paquete de noche, dura `horas_noche` del hotel) y `precio_hora_extra` (cada hora excedida sobre la salida prevista).
- **El trabajador solo elige del menú**: no puede inventar precios ni duraciones — el control comercial es del dueño.
- Editar la habitación **reemplaza el menú completo**; las estancias en curso o históricas no cambian (ver "foto de condiciones").
- Cada hotel arma menús distintos (el seed vende 3/6 h, 3/5 h y 3/4 h en sus tres hoteles): la relación precio/tiempo es 100 % personalizable por hotel y por habitación.

## Flujo de estancias

1. **Entrada** (`POST /estancias`, transacción con bloqueo de la habitación):
   - Habitación del hotel, activa y `disponible` (o `reservada` únicamente si se envía su `reserva_id` pendiente).
   - `hora_entrada = ahora(GT)`.
   - `tipo horas`: exige `tarifa_id` del menú de ESA habitación (triple filtro id+habitación+hotel; ajena → 404). `total_base = precio de la tarifa`; `hora_salida_prevista = entrada + horas de la tarifa`.
   - `tipo noche`: `hora_salida_prevista = entrada + horas_noche` del hotel (default 12); `total_base = precio_noche`.
   - **Foto de condiciones**: la estancia copia `tarifa_nombre`, horas y `precio_hora_extra` vigentes. Cambios de precios posteriores no alteran esta estancia.
   - Habitación → `ocupada`; reserva → `usada`; la UI pasa directo a la pantalla de cobro.
2. **Cobro base adelantado** (`pago-base`, transacción): así operan los autohoteles reales. Efectivo valida `recibido ≥ total` y calcula el **cambio**; registra el cobro en el libro. Puede posponerse ("cobrar en la salida"): `pagado_base` queda 0 y la salida lo liquida.
3. **Pedidos** durante la estancia (ver inventario).
4. **Salida** (`salida`, transacción):
   - `horas_extra = techo((ahora − salida_prevista) / 1h)` si se excedió (aplica también a noche), cobradas al `precio_hora_extra` **fotografiado en la estancia** (no al precio actual).
   - `total_pendiente = base_no_pagada + total_extra + total_pedidos`. Si > 0 exige método de pago (efectivo valida y da cambio).
   - Guarda `hora_salida_real`, totales y estado `finalizada`; habitación → `limpieza` con `limpieza_desde = ahora`; registra el cobro de salida con desglose.
5. Los totales de la estancia (`total_base/extra/habitacion/pedidos/final`) se calculan **siempre en backend**; el frontend solo muestra.

## Flujo de pagos (dinero del hotel)

- Todo ingreso queda en **`cobros`**: `base` (adelanto) o `salida` (liquidación), con `monto_habitacion`, `monto_pedidos`, `monto_total`, método, fecha y usuario.
- **Dashboard**: ingresos del día = `SUM(monto_total)` de cobros de hoy (GT); clientes del día = estancias con entrada hoy.
- **Reportes** (rango ≤ 366 días): ingresos por día y por habitación desde `cobros`; productos más vendidos desde `pedidos`; listado de estancias para cuadre.
- Métodos: `efectivo` (con cambio calculado) y `transferencia`.

## Flujo de inventario

- **Punto de venta de la estancia**: el modal de pedidos tiene buscador con filtrado instantáneo (sin recargar, ignora mayúsculas/acentos), selección con Enter o clic, cantidad con +/− y subtotal en vivo. El inventario tiene el mismo buscador.
- **Pedido** (transacción): bloquea producto (`FOR UPDATE`) → valida `stock ≥ cantidad` (el stock **nunca** queda negativo, también es UNSIGNED) → inserta pedido con `precio_unitario` del momento → descuenta stock → registra movimiento `salida` → acumula `total_pedidos` de la estancia.
- **Ingreso de mercadería** (dueño y trabajador): suma stock + movimiento `entrada` con cantidad, motivo, **usuario** y fecha (auditable por el dueño).
- **Producto nuevo**: ambos roles; el trabajador puede indicar el precio de llegada o dejarlo en Q0 (etiqueta "Sin precio" hasta que el dueño lo confirme). El stock inicial genera movimiento de entrada.
- **Ajustes** (solo dueño): sumar/restar con motivo obligatorio; restar valida que no quede negativo (movimientos `ajuste_positivo/negativo`).
- **Solo dueño**: editar precio/nombre/mínimo, desactivar producto y ver el historial de movimientos.
- **Alerta bajo stock**: `stock ≤ stock_minimo` (productos activos).

## Flujo de reservas

- Crear: habitación `disponible` + fecha futura → habitación `reservada` (morado). Máx. una pendiente por habitación.
- Llega el cliente: entrada con `reserva_id` → reserva `usada`, habitación `ocupada`.
- Cancelar: reserva `cancelada`, habitación → `disponible`.
- Intentar una entrada directa sobre habitación reservada se rechaza: hay que usar la reserva o cancelarla.

## Flujo de suscripciones (SaaS)

- Cada dueño tiene UNA suscripción con `fecha_vencimiento` y `estado` (`activa`/`suspendida` manual).
- **Bloqueo de acceso** (login y cada petición): suscripción `suspendida` **o** `fecha_vencimiento < hoy(GT)` → mensaje exacto *"Servicio suspendido, comuníquese con el proveedor"* para el dueño **y todos sus trabajadores**. No requiere tarea programada.
- **Estados mostrados al superadmin**: `suspendida` → manual; `vencida` → fecha pasada; `por_vencer` → faltan ≤ N días (config `DIAS_POR_VENCER`, default 5); `activa` → resto.
- **Pago de mensualidad**: inserta en `pagos_servicio` y extiende `fecha_vencimiento = max(hoy, vencimiento) + 1 mes` (ajuste de fin de mes), reactivando la cuenta. Historial consultable.
- **Reactivación manual** solo quita la suspensión; si la fecha ya venció sigue bloqueado hasta pagar.

## Alertas automáticas

| Alerta | Condición | Visible para |
|---|---|---|
| Tiempo excedido | estancia activa con `hora_salida_prevista < ahora` | dueño y trabajador |
| Sin limpiar | habitación en `limpieza` hace más de `minutos_alerta_limpieza` (config por hotel, default 30) | dueño y trabajador |
| Bajo stock | producto activo con `stock ≤ stock_minimo` | dueño y trabajador |

Campana con badge en la barra superior (polling 25 s) y lista completa en el dashboard del dueño.

## Control de caja y gastos operativos

- **Apertura**: si el hotel no tiene caja abierta, quien abra (dueño o trabajador) debe declarar el **monto inicial exacto** en efectivo (el "sencillo"). Solo puede existir **una caja abierta por hotel** (garantizado con índice UNIQUE en BD, no solo en la aplicación).
- **Bloqueo operativo**: un **trabajador** no puede registrar cobros **en efectivo** (habitación o productos) sin caja abierta → HTTP 409 con mensaje claro. Las transferencias nunca se bloquean (no tocan el efectivo físico). El **dueño está exento** del bloqueo (decisión 35). El registro de la entrada en sí no exige caja: el dinero entra en el cobro.
- **Retiros y gastos compartidos**: dueño Y trabajador pueden sacar efectivo de la caja activa. Requisitos: monto > 0 que no exceda el efectivo disponible, y **justificación obligatoria**.
- **Notas automáticas**: cada retiro genera y guarda una nota inmutable con la fecha exacta del movimiento, formato estricto `DD-MM-YYYY se retira [monto] para [justificación]` (ej.: "17-07-2026 se retira 100 para desayuno trabajadores"). El retiro del efectivo al cerrar genera `DD-MM-YYYY se retira efectivo del hotel`.
- **Cierre flexible**: lo puede hacer el trabajador o el jefe (dueño). Se declara el efectivo físico contado y el sistema calcula:
  - `esperado = monto_inicial + ventas en efectivo del turno − retiros/gastos`
  - `descuadre = declarado − esperado` (positivo = sobrante, negativo = faltante)
  - Opcionalmente se registra el retiro del efectivo final con su nota (posterior al arqueo: no altera la fórmula).
  - Al cerrar, el trabajador termina su turno (se cierra su sesión); el dueño continúa en el panel.
- **Auditoría del dueño**: la sección "Cajas" muestra cada turno con fondo, retiros, esperado, declarado, arqueo (cuadra/sobrante/faltante) y las notas de retiros del turno.

## Usuarios y jerarquía

- El dueño solo ve/crea/edita/desactiva trabajadores **suyos** (`dueno_id`) y solo puede asignarlos a **sus** hoteles.
- Desactivar es reversible y bloquea el login al instante (no se borra: los movimientos y estancias del usuario se conservan).
- El dueño también puede operar (tablero, entradas, cobros...): útil en hoteles pequeños.
