# 02 · Base de datos

Base: `autohotel_saas` · charset `utf8mb4_unicode_ci` · motor InnoDB.
Todas las fechas/horas se guardan en **hora de Guatemala (GMT-6)** como `DATETIME`; el backend calcula "ahora" y lo pasa como parámetro (nunca se usa `NOW()` del servidor para reglas de negocio).

## Diagrama de relaciones

```
usuarios (superadmin/dueno/trabajador)
  ├─< hoteles (dueno_id)
  │     ├─< habitaciones ──< tarifas (menú precio/tiempo por habitación)
  │     │        │
  │     │        ├──< estancias ──< pedidos >── productos
  │     │        │       │            │
  │     │        │       └──< cobros  └──< movimientos_inventario
  │     │        └──< reservas
  │     └─ (hotel_id en todas las tablas operativas)
  ├─1 suscripciones (dueno_id, UNIQUE)
  └─< pagos_servicio (dueno_id)
sesiones (express-mysql-session)
```

## Tablas

### usuarios
| Campo | Tipo | Notas |
|---|---|---|
| id | INT UNSIGNED PK AI | |
| rol | ENUM('superadmin','dueno','trabajador') | |
| nombre | VARCHAR(100) | |
| usuario | VARCHAR(50) **UNIQUE** | login global |
| password_hash | VARCHAR(100) | bcrypt (10 rondas) |
| dueno_id | INT NULL FK→usuarios.id | solo trabajadores: su dueño (para validar suscripción con 1 JOIN) |
| hotel_id | INT NULL FK→hoteles.id | solo trabajadores: SU hotel |
| activo | TINYINT(1) | desactivar bloquea el login sin borrar (auditoría) |
| creado_en | DATETIME | |

Índices: `uq_usuarios_usuario`, `idx_usuarios_dueno`, `idx_usuarios_hotel`.
FK circular usuarios⇄hoteles: la FK de `hotel_id` se agrega con `ALTER TABLE` tras crear `hoteles`.

### hoteles
`id, dueno_id FK→usuarios, nombre, direccion, minutos_alerta_limpieza (default 30), horas_noche (default 12), activo, creado_en`
Configuración por hotel: umbral de alerta de limpieza y duración de la "noche".
Índice: `idx_hoteles_dueno`.

### suscripciones (una por dueño)
`id, dueno_id UNIQUE FK, estado ENUM('activa','suspendida'), fecha_vencimiento DATE, actualizado_en`
- `estado` guarda SOLO la suspensión manual del superadmin.
- "vencida" se **calcula**: `fecha_vencimiento < hoy(GT)`. "por_vencer": faltan ≤ `DIAS_POR_VENCER` días (config).
- El login y cada petición comparan estas condiciones → el bloqueo por vencimiento es automático, sin tareas programadas.

### pagos_servicio (mensualidades del SaaS)
`id, dueno_id FK, monto DECIMAL(10,2), fecha_pago DATETIME, mes_correspondiente CHAR(7) 'AAAA-MM', nota, registrado_por FK→usuarios`
Índice: `idx_pagos_dueno`.

### habitaciones
`id, hotel_id FK, nombre VARCHAR(50), estado ENUM('disponible','ocupada','limpieza','reservada'), precio_noche DECIMAL(10,2), precio_hora_extra DECIMAL(10,2), limpieza_desde DATETIME NULL, activo`
- `precio_noche`: paquete "noche completa" (dura `horas_noche` del hotel).
- `precio_hora_extra`: tarifa por cada hora excedida sobre la salida prevista; se **fotografía** en la estancia al registrar la entrada.
- Las tarifas por tiempo viven en la tabla `tarifas` (menú por habitación).
- `limpieza_desde`: cuándo entró a limpieza (para la alerta de "sin limpiar").
- Únicos: `(hotel_id, nombre)`. Índice: `(hotel_id, estado)` para el tablero.

### tarifas (motor de tarifas dinámicas)
`id, hotel_id FK, habitacion_id FK (ON DELETE CASCADE), nombre VARCHAR(60), horas INT UNSIGNED, precio DECIMAL(10,2)`
- Menú de paquetes precio/tiempo de cada habitación, definido por el dueño (ej. "3 horas" = Q100, "6 horas" = Q160). Mínimo 1, máximo 8 por habitación; nombre único por habitación.
- La entrada por tiempo exige elegir una tarifa **de esa habitación y ese hotel** (la consulta valida el triple filtro → un ID ajeno devuelve 404).
- Editar una habitación **reemplaza** su menú completo (transacción DELETE+INSERT); la historia no se rompe porque cada estancia guarda su foto y `estancias.tarifa_id` es `ON DELETE SET NULL`.
- Únicos: `(habitacion_id, nombre)`. Índices: `(hotel_id)` · `(habitacion_id, horas)`.

### estancias (corazón del negocio)
| Campo | Notas |
|---|---|
| hotel_id, habitacion_id, creado_por | FKs |
| placa VARCHAR(20) | vehículo |
| tipo ENUM('horas','noche') · horas_contratadas | |
| tarifa_id INT NULL FK→tarifas (ON DELETE SET NULL) | tarifa elegida al entrar (referencia) |
| tarifa_nombre VARCHAR(60) | **foto** del nombre pactado ("3 horas" / "Noche completa") |
| precio_hora_extra DECIMAL(10,2) | **foto** del precio de hora extra al entrar |
| hora_entrada · hora_salida_prevista · hora_salida_real | DATETIME GT |
| horas_extra INT | calculadas al finalizar (techo del excedente) |
| cargo_extra DECIMAL(10,2) | **foto** de cargos adicionales: recargo de reserva + extras (jacuzzi, decoración), elegidos en la entrada o agregados con la estancia en curso |
| cargo_descripcion VARCHAR(200) | detalle legible, nombres unidos con " + " (ej. "Jacuzzi + Decoración") |
| cargo_extra_pagado DECIMAL(10,2) | porción del cargo adicional ya saldada con el cobro base (v2.9); lo agregado después de pagar = `cargo_extra − cargo_extra_pagado` queda como saldo pendiente que la salida liquida |
| total_base | cobro adelantado (precio de la tarifa o precio_noche) |
| total_extra | horas_extra × precio_hora_extra (el fotografiado) |
| total_habitacion | base + extra |
| total_pedidos | acumulado transaccional de pedidos |
| total_final | habitación + cargo_extra + pedidos |
| pagado_base TINYINT | ¿ya se cobró el adelanto? |
| metodo_pago / metodo_pago_salida | ENUM('efectivo','transferencia') NULL |
| estado ENUM('activa','finalizada') | |

La **foto de condiciones** (tarifa_nombre, horas, precio, precio_hora_extra) garantiza que cambiar precios a media estancia jamás altera lo pactado con el cliente ni la historia.

Índices: `(hotel_id, estado)` tablero/activas · `(hotel_id, hora_entrada)` reportes · `(habitacion_id, estado)` JOIN del tablero.

### productos
`id, hotel_id FK, nombre, precio DECIMAL(10,2), stock INT UNSIGNED, stock_minimo INT UNSIGNED, activo, creado_en`
`stock` es UNSIGNED y además el backend valida en transacción → **nunca negativo**. Índice `(hotel_id, activo)`.

### pedidos (consumos)
`id, hotel_id, estancia_id FK, producto_id FK, cantidad, precio_unitario (foto del precio), subtotal, fecha, usuario_id FK`
Índices: `(hotel_id, fecha)` reportes · `(estancia_id)` · `(producto_id)`.

### movimientos_inventario (auditoría)
`id, hotel_id, producto_id FK, tipo ENUM('entrada','salida','ajuste_positivo','ajuste_negativo'), cantidad (siempre positiva), motivo, usuario_id FK, fecha`
Cada cambio de stock (pedido, ingreso de mercadería, ajuste, stock inicial) deja fila aquí con el **usuario** que lo hizo. Desde v2.9 los ajustes (baja por consumo interno, daño, conteo físico) los registran **dueño y trabajador**, siempre con justificación obligatoria en `motivo`; el historial de auditoría sigue siendo solo del dueño. Un ajuste **no toca la caja**: no involucra dinero, solo existencias.

### reservas
`id, hotel_id, habitacion_id FK, fecha_hora DATETIME, placa, nota, estado ENUM('pendiente','usada','cancelada'), creado_por FK, creado_en`
Regla: crear una reserva exige habitación disponible → máximo una pendiente por habitación.
Índice compuesto `(habitacion_id, estado, fecha_hora)`: sirve exactamente la subconsulta del tablero (reserva pendiente más próxima por habitación).

### cobros (libro de ingresos)
`id, hotel_id, estancia_id FK, habitacion_id FK, tipo ENUM('base','salida'), monto_habitacion, monto_pedidos, monto_total, metodo, fecha, usuario_id`
- `base`: cobro adelantado al registrar la entrada (todo habitación).
- `salida`: liquidación al finalizar (base pendiente + horas extra en `monto_habitacion`; consumos en `monto_pedidos`).
- **Dashboard y reportes se calculan de aquí** → siempre cuadran con el dinero real cobrado.
Índices: `(hotel_id, fecha)`, `(estancia_id)`, `(habitacion_id)`.

### turnos_caja
Control del efectivo físico por turno. Quien abre (dueño o trabajador) declara el **fondo inicial** ("sencillo"); al cerrar se declara el efectivo contado y el sistema calcula el arqueo.

| Columna | Uso |
|---|---|
| `hotel_id`, `usuario_id` | multi-tenant + quién abrió |
| `monto_inicial` | fondo declarado al abrir |
| `fecha_apertura` / `fecha_cierre` | vida del turno (`fecha_cierre` NULL mientras está abierta) |
| `monto_sistema` | efectivo esperado calculado al cerrar (ver fórmula abajo) |
| `monto_declarado` | efectivo físico contado por la persona |
| `descuadre` | `monto_declarado − monto_sistema` (+ sobrante / − faltante) |
| `estado` | `abierta` / `cerrada` |
| `cerrado_por` | quién hizo el cierre (puede ser distinto de quien abrió) |
| `hotel_abierta` | = `hotel_id` mientras está abierta, NULL al cerrar; su índice **UNIQUE** garantiza a nivel de motor UNA sola caja abierta por hotel (los NULL no colisionan) |

`cobros.turno_id` (FK, `ON DELETE SET NULL`) enlaza cada cobro con la caja abierta en ese momento: el arqueo suma solo lo cobrado en su turno.

**Fórmula del cierre**: `monto_sistema = monto_inicial + Σ(cobros en efectivo del turno) − Σ(retiros tipo 'gasto' del turno)`. Las transferencias no tocan el efectivo físico y quedan fuera.

### retiros_caja
Salidas de efectivo de una caja **abierta** (gastos operativos o retiros del dueño). Dueño y trabajador pueden retirar; el monto no puede exceder el efectivo disponible y la **justificación es obligatoria**.

| Columna | Uso |
|---|---|
| `hotel_id`, `turno_id`, `usuario_id` | multi-tenant + a qué turno pertenece + quién retiró |
| `tipo` | `gasto` (entra a la fórmula del arqueo) / `cierre` (retiro del efectivo declarado al cerrar; NO entra: ocurre después del arqueo) |
| `monto`, `justificacion` | lo retirado y su porqué |
| `nota` | **nota autogenerada e inmutable** con formato estricto: `DD-MM-YYYY se retira [monto] para [justificación]` (monto sin símbolo: `100` o `100.50`); para el cierre: `DD-MM-YYYY se retira efectivo del hotel` |
| `fecha` | momento exacto del movimiento (hora GT) |

### sesiones
Tabla de `express-mysql-session` (`session_id, expires, data`). Se crea en el schema para que exista desde la importación.

## Integridad

- FKs en todas las relaciones (InnoDB).
- Flujos críticos en transacciones con `SELECT ... FOR UPDATE` sobre la fila caliente (habitación al registrar entrada, estancia al cobrar/finalizar, producto al descontar stock, suscripción al pagar, hotel al desactivar) → sin dobles entradas ni stock negativo bajo concurrencia.
- `schema.sql` desactiva `FOREIGN_KEY_CHECKS` solo durante los `DROP` (FK circular usuarios⇄hoteles) y lo restaura al final.

## Migración al motor de tarifas

Instalaciones que ya tenían datos con el esquema anterior (`habitaciones.precio_hora`) se migran con **`db/migracion_tarifas.sql`** (con el servidor detenido y respaldo previo): crea `tarifas`, agrega `precio_hora_extra` (hereda `precio_hora`), genera una tarifa inicial "3 horas" por habitación (`precio_hora × 3`), agrega la foto a `estancias` (las históricas heredan su precio vigente y un nombre legible), elimina `precio_hora` y mejora los índices. Instalaciones nuevas NO la ejecutan: `schema.sql` + `seed.sql` ya traen todo.
