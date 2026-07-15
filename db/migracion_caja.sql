-- ============================================================
-- Migración: Módulo de Control de Caja (turnos de efectivo).
-- Para instalaciones que ya tienen datos; las nuevas usan
-- schema.sql directamente.
--
-- Crea la tabla turnos_caja y agrega cobros.turno_id para enlazar
-- cada cobro con la caja abierta en ese momento.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS turnos_caja (
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

ALTER TABLE cobros
  ADD COLUMN turno_id INT UNSIGNED NULL AFTER habitacion_id,
  ADD KEY idx_cobros_turno (turno_id),
  ADD CONSTRAINT fk_cobros_turno FOREIGN KEY (turno_id) REFERENCES turnos_caja (id) ON DELETE SET NULL;
