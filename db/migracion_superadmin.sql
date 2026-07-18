-- ============================================================
-- Migración: módulo Super Admin ampliado (v2.6).
-- Para instalaciones que ya tienen datos; las nuevas usan
-- schema.sql directamente.
--
-- 1) Ficha del propietario en usuarios (DPI, NIT, contacto…)
--    + ultimo_acceso para auditoría de accesos.
-- 2) Tabla auditoria (acciones administrativas).
-- 3) Tabla politicas_retencion (limpieza de datos históricos).
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE usuarios
  ADD COLUMN dpi           VARCHAR(20)  NOT NULL DEFAULT '' AFTER creado_en,
  ADD COLUMN nit           VARCHAR(20)  NOT NULL DEFAULT '' AFTER dpi,
  ADD COLUMN telefono      VARCHAR(25)  NOT NULL DEFAULT '' AFTER nit,
  ADD COLUMN correo        VARCHAR(100) NOT NULL DEFAULT '' AFTER telefono,
  ADD COLUMN direccion     VARCHAR(200) NOT NULL DEFAULT '' AFTER correo,
  ADD COLUMN observaciones VARCHAR(500) NOT NULL DEFAULT '' AFTER direccion,
  ADD COLUMN ultimo_acceso DATETIME NULL AFTER observaciones;

CREATE TABLE IF NOT EXISTS auditoria (
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

CREATE TABLE IF NOT EXISTS politicas_retencion (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo             VARCHAR(40) NOT NULL,
  meses            INT UNSIGNED NOT NULL DEFAULT 24,
  programada       ENUM('manual','mensual','trimestral','anual') NOT NULL DEFAULT 'manual',
  ultima_ejecucion DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_politicas_tipo (tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
