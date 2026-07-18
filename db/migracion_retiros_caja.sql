-- ============================================================
-- Migración: retiros de caja y gastos operativos (v2.7).
-- Para instalaciones que ya tienen datos; las nuevas usan
-- schema.sql directamente.
--
-- Crea retiros_caja: salidas de efectivo de una caja abierta
-- (gastos operativos o retiros del dueño) con justificación y
-- NOTA autogenerada "DD-MM-YYYY se retira [monto] para [just.]".
-- El tipo 'cierre' guarda la nota "se retira efectivo del hotel".
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS retiros_caja (
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
