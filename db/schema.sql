-- ============================================================
-- AutoHotel SaaS - Esquema de base de datos
-- Motor: MySQL 5.7+ / MariaDB 10.4+
-- Todas las fechas/horas se guardan en hora de Guatemala (GMT-6)
-- ============================================================

SET NAMES utf8mb4;

CREATE DATABASE IF NOT EXISTS autohotel_saas
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE autohotel_saas;

-- Borrado de tablas: usuarios y hoteles se referencian entre sí
-- (dueño de hotel / trabajador con hotel), por lo que se
-- desactiva temporalmente la verificación de llaves foráneas.
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS auditoria;
DROP TABLE IF EXISTS politicas_retencion;
DROP TABLE IF EXISTS cobros;
DROP TABLE IF EXISTS retiros_caja;
DROP TABLE IF EXISTS turnos_caja;
DROP TABLE IF EXISTS pedidos;
DROP TABLE IF EXISTS movimientos_inventario;
DROP TABLE IF EXISTS reservas;
DROP TABLE IF EXISTS estancias;
DROP TABLE IF EXISTS tarifas;
DROP TABLE IF EXISTS productos;
DROP TABLE IF EXISTS habitaciones;
DROP TABLE IF EXISTS pagos_servicio;
DROP TABLE IF EXISTS suscripciones;
DROP TABLE IF EXISTS hoteles;
DROP TABLE IF EXISTS usuarios;
DROP TABLE IF EXISTS sesiones;
SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- USUARIOS
-- Jerarquía: superadmin -> dueños -> trabajadores
-- dueno_id: para trabajadores, apunta al usuario dueño del hotel.
-- hotel_id: solo para trabajadores (pertenecen a UN hotel).
-- ------------------------------------------------------------
CREATE TABLE usuarios (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rol           ENUM('superadmin','dueno','trabajador') NOT NULL,
  nombre        VARCHAR(100) NOT NULL,
  usuario       VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  dueno_id      INT UNSIGNED NULL,
  hotel_id      INT UNSIGNED NULL,
  activo        TINYINT(1) NOT NULL DEFAULT 1,
  creado_en     DATETIME NOT NULL,
  -- Ficha del propietario (la llena el superadmin; vacía en otros roles)
  dpi           VARCHAR(20)  NOT NULL DEFAULT '',
  nit           VARCHAR(20)  NOT NULL DEFAULT '',
  telefono      VARCHAR(25)  NOT NULL DEFAULT '',
  correo        VARCHAR(100) NOT NULL DEFAULT '',
  direccion     VARCHAR(200) NOT NULL DEFAULT '',
  observaciones VARCHAR(500) NOT NULL DEFAULT '',
  -- Último inicio de sesión exitoso (para auditoría de accesos)
  ultimo_acceso DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_usuario (usuario),
  KEY idx_usuarios_dueno (dueno_id),
  KEY idx_usuarios_hotel (hotel_id),
  CONSTRAINT fk_usuarios_dueno FOREIGN KEY (dueno_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- AUDITORÍA (acciones administrativas del superadmin y del
-- limpiador programado). usuario_id en NULL = acción del sistema.
-- Se guarda el nombre plano para que el registro sobreviva a la
-- eliminación del usuario.
-- ------------------------------------------------------------
CREATE TABLE auditoria (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id     INT UNSIGNED NULL,
  usuario_nombre VARCHAR(100) NOT NULL DEFAULT 'Sistema',
  accion         VARCHAR(100) NOT NULL,
  detalle        VARCHAR(500) NOT NULL DEFAULT '',
  ip             VARCHAR(45)  NOT NULL DEFAULT '',
  fecha          DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_auditoria_fecha (fecha),
  KEY idx_auditoria_accion (accion)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- POLÍTICAS DE RETENCIÓN (limpieza de datos históricos)
-- meses = cuánto conservar; programada = frecuencia de limpieza
-- automática ('manual' = solo a mano). Las filas por defecto las
-- crea el servicio al primer uso (también en instalaciones viejas).
-- ------------------------------------------------------------
CREATE TABLE politicas_retencion (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo             VARCHAR(40) NOT NULL,
  meses            INT UNSIGNED NOT NULL DEFAULT 24,
  programada       ENUM('manual','mensual','trimestral','anual') NOT NULL DEFAULT 'manual',
  ultima_ejecucion DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_politicas_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- HOTELES
-- Un dueño puede tener varios hoteles.
-- minutos_alerta_limpieza y horas_noche son configurables por hotel.
-- ------------------------------------------------------------
CREATE TABLE hoteles (
  id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dueno_id                INT UNSIGNED NOT NULL,
  nombre                  VARCHAR(100) NOT NULL,
  direccion               VARCHAR(200) NOT NULL DEFAULT '',
  minutos_alerta_limpieza INT UNSIGNED NOT NULL DEFAULT 30,
  horas_noche             INT UNSIGNED NOT NULL DEFAULT 12,
  activo                  TINYINT(1) NOT NULL DEFAULT 1,
  creado_en               DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hoteles_dueno (dueno_id),
  CONSTRAINT fk_hoteles_dueno FOREIGN KEY (dueno_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La FK de usuarios.hotel_id se agrega después de crear hoteles
ALTER TABLE usuarios
  ADD CONSTRAINT fk_usuarios_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id);

-- ------------------------------------------------------------
-- SUSCRIPCIONES (una por dueño)
-- estado: 'activa' o 'suspendida' (suspensión manual del superadmin).
-- "vencida" se calcula: fecha_vencimiento < hoy.
-- ------------------------------------------------------------
CREATE TABLE suscripciones (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dueno_id          INT UNSIGNED NOT NULL,
  estado            ENUM('activa','suspendida') NOT NULL DEFAULT 'activa',
  fecha_vencimiento DATE NOT NULL,
  actualizado_en    DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_suscripciones_dueno (dueno_id),
  CONSTRAINT fk_suscripciones_dueno FOREIGN KEY (dueno_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- PAGOS DE SERVICIO (mensualidades que cobra el superadmin)
-- mes_correspondiente en formato 'YYYY-MM'.
-- ------------------------------------------------------------
CREATE TABLE pagos_servicio (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  dueno_id           INT UNSIGNED NOT NULL,
  monto              DECIMAL(10,2) NOT NULL,
  fecha_pago         DATETIME NOT NULL,
  mes_correspondiente CHAR(7) NOT NULL,
  nota               VARCHAR(200) NOT NULL DEFAULT '',
  registrado_por     INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pagos_dueno (dueno_id),
  CONSTRAINT fk_pagos_dueno FOREIGN KEY (dueno_id) REFERENCES usuarios (id),
  CONSTRAINT fk_pagos_registrado FOREIGN KEY (registrado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- HABITACIONES
-- limpieza_desde: momento en que entró a estado 'limpieza'
-- (permite la alerta de "habitación sin limpiar").
-- precio_noche: paquete "noche completa" (dura horas_noche del hotel).
-- precio_hora_extra: tarifa por cada hora excedida sobre la salida
-- prevista (se "fotografía" en la estancia al registrar la entrada).
-- Las tarifas por tiempo (Q100/3h, Q160/6h, ...) viven en `tarifas`.
-- ------------------------------------------------------------
CREATE TABLE habitaciones (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id          INT UNSIGNED NOT NULL,
  nombre            VARCHAR(50) NOT NULL,
  estado            ENUM('disponible','ocupada','limpieza','reservada') NOT NULL DEFAULT 'disponible',
  precio_noche      DECIMAL(10,2) NOT NULL DEFAULT 0,
  precio_hora_extra DECIMAL(10,2) NOT NULL DEFAULT 0,
  limpieza_desde    DATETIME NULL,
  activo            TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_habitaciones_hotel_nombre (hotel_id, nombre),
  KEY idx_habitaciones_hotel_estado (hotel_id, estado),
  CONSTRAINT fk_habitaciones_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- TARIFAS (motor de tarifas dinámicas)
-- Cada habitación define su propio menú de paquetes precio/tiempo,
-- por ejemplo: "3 horas" = Q100, "6 horas" = Q160.
-- Al registrar una entrada por tiempo se ELIGE una tarifa: el cobro
-- y el contador se calculan de ella (precio y horas), y la estancia
-- guarda una foto (nombre, horas, precio) para que la historia no
-- cambie aunque el dueño edite las tarifas después.
-- ------------------------------------------------------------
CREATE TABLE tarifas (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id      INT UNSIGNED NOT NULL,
  habitacion_id INT UNSIGNED NOT NULL,
  nombre        VARCHAR(60) NOT NULL,
  horas         INT UNSIGNED NOT NULL,
  precio        DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tarifas_habitacion_nombre (habitacion_id, nombre),
  KEY idx_tarifas_hotel (hotel_id),
  KEY idx_tarifas_habitacion (habitacion_id, horas),
  CONSTRAINT fk_tarifas_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_tarifas_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- PRODUCTOS (inventario por hotel)
-- ------------------------------------------------------------
CREATE TABLE productos (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id     INT UNSIGNED NOT NULL,
  nombre       VARCHAR(100) NOT NULL,
  precio       DECIMAL(10,2) NOT NULL DEFAULT 0,
  stock        INT UNSIGNED NOT NULL DEFAULT 0,
  stock_minimo INT UNSIGNED NOT NULL DEFAULT 0,
  activo       TINYINT(1) NOT NULL DEFAULT 1,
  creado_en    DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_productos_hotel (hotel_id, activo),
  CONSTRAINT fk_productos_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- ESTANCIAS (el corazón del negocio)
-- total_base: cobro adelantado (tarifa elegida o precio de noche).
-- total_extra: horas extra cobradas en la salida.
-- total_habitacion = total_base + total_extra.
-- total_final = total_habitacion + total_pedidos.
-- tarifa_id / tarifa_nombre / precio_hora_extra: FOTO de las
-- condiciones pactadas al registrar la entrada. Si el dueño cambia
-- precios a media estancia, esta estancia conserva lo pactado.
-- ------------------------------------------------------------
CREATE TABLE estancias (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id             INT UNSIGNED NOT NULL,
  habitacion_id        INT UNSIGNED NOT NULL,
  placa                VARCHAR(20) NOT NULL,
  tipo                 ENUM('horas','noche') NOT NULL,
  tarifa_id            INT UNSIGNED NULL,
  tarifa_nombre        VARCHAR(60) NOT NULL DEFAULT '',
  horas_contratadas    INT UNSIGNED NOT NULL DEFAULT 0,
  precio_hora_extra    DECIMAL(10,2) NOT NULL DEFAULT 0,
  hora_entrada         DATETIME NOT NULL,
  hora_salida_prevista DATETIME NOT NULL,
  hora_salida_real     DATETIME NULL,
  horas_extra          INT UNSIGNED NOT NULL DEFAULT 0,
  -- Foto del recargo de la reserva que originó la estancia (si hubo)
  cargo_extra          DECIMAL(10,2) NOT NULL DEFAULT 0,
  cargo_descripcion    VARCHAR(200) NOT NULL DEFAULT '',
  total_base           DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_extra          DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_habitacion     DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_pedidos        DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_final          DECIMAL(10,2) NOT NULL DEFAULT 0,
  pagado_base          TINYINT(1) NOT NULL DEFAULT 0,
  metodo_pago          ENUM('efectivo','transferencia') NULL,
  metodo_pago_salida   ENUM('efectivo','transferencia') NULL,
  estado               ENUM('activa','finalizada') NOT NULL DEFAULT 'activa',
  creado_por           INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_estancias_hotel_estado (hotel_id, estado),
  KEY idx_estancias_habitacion_estado (habitacion_id, estado),
  KEY idx_estancias_hotel_entrada (hotel_id, hora_entrada),
  CONSTRAINT fk_estancias_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_estancias_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitaciones (id),
  CONSTRAINT fk_estancias_tarifa FOREIGN KEY (tarifa_id) REFERENCES tarifas (id) ON DELETE SET NULL,
  CONSTRAINT fk_estancias_usuario FOREIGN KEY (creado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- PEDIDOS (consumos dentro de una estancia)
-- precio_unitario es una "foto" del precio al momento del pedido.
-- ------------------------------------------------------------
CREATE TABLE pedidos (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id        INT UNSIGNED NOT NULL,
  estancia_id     INT UNSIGNED NOT NULL,
  producto_id     INT UNSIGNED NOT NULL,
  cantidad        INT UNSIGNED NOT NULL,
  precio_unitario DECIMAL(10,2) NOT NULL,
  subtotal        DECIMAL(10,2) NOT NULL,
  fecha           DATETIME NOT NULL,
  usuario_id      INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_pedidos_hotel_fecha (hotel_id, fecha),
  KEY idx_pedidos_estancia (estancia_id),
  KEY idx_pedidos_producto (producto_id),
  CONSTRAINT fk_pedidos_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_pedidos_estancia FOREIGN KEY (estancia_id) REFERENCES estancias (id),
  CONSTRAINT fk_pedidos_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_pedidos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- MOVIMIENTOS DE INVENTARIO (auditoría de entradas/salidas/ajustes)
-- cantidad siempre positiva; el tipo indica la dirección.
-- ------------------------------------------------------------
CREATE TABLE movimientos_inventario (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id    INT UNSIGNED NOT NULL,
  producto_id INT UNSIGNED NOT NULL,
  tipo        ENUM('entrada','salida','ajuste_positivo','ajuste_negativo') NOT NULL,
  cantidad    INT UNSIGNED NOT NULL,
  motivo      VARCHAR(200) NOT NULL DEFAULT '',
  usuario_id  INT UNSIGNED NOT NULL,
  fecha       DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_movimientos_hotel_fecha (hotel_id, fecha),
  KEY idx_movimientos_producto (producto_id),
  CONSTRAINT fk_movimientos_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_movimientos_producto FOREIGN KEY (producto_id) REFERENCES productos (id),
  CONSTRAINT fk_movimientos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- RESERVAS
-- ------------------------------------------------------------
CREATE TABLE reservas (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id          INT UNSIGNED NOT NULL,
  habitacion_id     INT UNSIGNED NOT NULL,
  fecha_hora        DATETIME NOT NULL,
  placa             VARCHAR(20) NOT NULL DEFAULT '',
  nota              VARCHAR(200) NOT NULL DEFAULT '',
  -- Recargo por reservar + extras solicitados (ej. decoración).
  -- Se FOTOGRAFÍA en la estancia al convertir la reserva en entrada.
  cargo_extra       DECIMAL(10,2) NOT NULL DEFAULT 0,
  cargo_descripcion VARCHAR(200) NOT NULL DEFAULT '',
  estado            ENUM('pendiente','usada','cancelada') NOT NULL DEFAULT 'pendiente',
  creado_por        INT UNSIGNED NOT NULL,
  creado_en         DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_reservas_hotel_estado (hotel_id, estado),
  KEY idx_reservas_habitacion_estado (habitacion_id, estado, fecha_hora),
  CONSTRAINT fk_reservas_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_reservas_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitaciones (id),
  CONSTRAINT fk_reservas_usuario FOREIGN KEY (creado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- TURNOS DE CAJA (control del efectivo físico por turno)
-- Un trabajador abre su caja con un fondo ("sencillo"), opera, y
-- al cerrar declara el efectivo contado. El sistema calcula el
-- efectivo esperado (fondo + cobros en efectivo del turno) y el
-- descuadre (declarado - sistema).
-- La columna hotel_abierta garantiza UNA sola caja abierta por
-- hotel: vale hotel_id mientras la caja está abierta y NULL al
-- cerrarse (los valores NULL no colisionan en un índice UNIQUE).
-- ------------------------------------------------------------
CREATE TABLE turnos_caja (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id        INT UNSIGNED NOT NULL,
  usuario_id      INT UNSIGNED NOT NULL,
  monto_inicial   DECIMAL(10,2) NOT NULL DEFAULT 0,
  fecha_apertura  DATETIME NOT NULL,
  fecha_cierre    DATETIME NULL,
  monto_sistema   DECIMAL(10,2) NULL,
  monto_declarado DECIMAL(10,2) NULL,
  descuadre       DECIMAL(10,2) NULL,
  estado          ENUM('abierta','cerrada') NOT NULL DEFAULT 'abierta',
  cerrado_por     INT UNSIGNED NULL,
  hotel_abierta   INT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_turnos_una_abierta (hotel_abierta),
  KEY idx_turnos_hotel (hotel_id, fecha_apertura),
  CONSTRAINT fk_turnos_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_turnos_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_turnos_cerrado_por FOREIGN KEY (cerrado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- RETIROS DE CAJA (gastos operativos y retiros del dueño)
-- Cada salida de efectivo de una caja abierta exige monto y
-- justificación, y guarda una NOTA autogenerada con formato
-- estricto: "DD-MM-YYYY se retira [monto] para [justificación]".
-- tipo 'cierre' = retiro del efectivo declarado al cerrar el
-- turno ("DD-MM-YYYY se retira efectivo del hotel"); NO entra en
-- la fórmula del descuadre (ocurre después del arqueo).
-- ------------------------------------------------------------
CREATE TABLE retiros_caja (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id      INT UNSIGNED NOT NULL,
  turno_id      INT UNSIGNED NOT NULL,
  usuario_id    INT UNSIGNED NOT NULL,
  tipo          ENUM('gasto','cierre') NOT NULL DEFAULT 'gasto',
  monto         DECIMAL(10,2) NOT NULL,
  justificacion VARCHAR(200) NOT NULL,
  nota          VARCHAR(250) NOT NULL,
  fecha         DATETIME NOT NULL,
  PRIMARY KEY (id),
  KEY idx_retiros_turno (turno_id),
  KEY idx_retiros_hotel_fecha (hotel_id, fecha),
  CONSTRAINT fk_retiros_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_retiros_turno FOREIGN KEY (turno_id) REFERENCES turnos_caja (id),
  CONSTRAINT fk_retiros_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- COBROS (libro de ingresos reales)
-- Cada vez que entra dinero se registra aquí:
--   tipo 'base'   = cobro adelantado al registrar la entrada
--   tipo 'salida' = liquidación al finalizar (extras + pedidos)
-- Los reportes e ingresos del día se calculan de esta tabla,
-- por lo que siempre cuadran con el dinero cobrado.
-- turno_id enlaza el cobro con la caja abierta en ese momento (si
-- la había): así el cierre de caja suma solo lo cobrado en su turno.
-- ------------------------------------------------------------
CREATE TABLE cobros (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id         INT UNSIGNED NOT NULL,
  estancia_id      INT UNSIGNED NOT NULL,
  habitacion_id    INT UNSIGNED NOT NULL,
  turno_id         INT UNSIGNED NULL,
  tipo             ENUM('base','salida') NOT NULL,
  monto_habitacion DECIMAL(10,2) NOT NULL DEFAULT 0,
  monto_pedidos    DECIMAL(10,2) NOT NULL DEFAULT 0,
  monto_total      DECIMAL(10,2) NOT NULL,
  metodo           ENUM('efectivo','transferencia') NOT NULL,
  fecha            DATETIME NOT NULL,
  usuario_id       INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  KEY idx_cobros_hotel_fecha (hotel_id, fecha),
  KEY idx_cobros_estancia (estancia_id),
  KEY idx_cobros_habitacion (habitacion_id),
  KEY idx_cobros_turno (turno_id),
  CONSTRAINT fk_cobros_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_cobros_estancia FOREIGN KEY (estancia_id) REFERENCES estancias (id),
  CONSTRAINT fk_cobros_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitaciones (id),
  CONSTRAINT fk_cobros_turno FOREIGN KEY (turno_id) REFERENCES turnos_caja (id) ON DELETE SET NULL,
  CONSTRAINT fk_cobros_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- SESIONES (la usa express-mysql-session; se define aquí para
-- que exista desde la importación del esquema)
-- ------------------------------------------------------------
CREATE TABLE sesiones (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires    INT UNSIGNED NOT NULL,
  data       MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
