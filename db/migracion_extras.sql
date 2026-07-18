-- ============================================================
-- Migración: extras opcionales por habitación (v2.8).
-- Para instalaciones que ya tienen datos; las nuevas usan
-- schema.sql directamente.
--
-- El dueño define qué habitaciones ofrecen extras (ej. jacuzzi
-- +Q40) y el recepcionista los activa al registrar la entrada.
-- El cargo se fotografía en la estancia (cargo_extra), así que
-- no se requieren cambios en estancias ni en cobros.
-- ============================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS extras_habitacion (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id      INT UNSIGNED NOT NULL,
  habitacion_id INT UNSIGNED NOT NULL,
  nombre        VARCHAR(60) NOT NULL,
  precio        DECIMAL(10,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_extras_habitacion_nombre (habitacion_id, nombre),
  KEY idx_extras_hotel (hotel_id),
  CONSTRAINT fk_extras_hotel FOREIGN KEY (hotel_id) REFERENCES hoteles (id),
  CONSTRAINT fk_extras_habitacion FOREIGN KEY (habitacion_id) REFERENCES habitaciones (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
