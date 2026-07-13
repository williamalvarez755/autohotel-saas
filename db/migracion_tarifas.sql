-- ============================================================
-- MIGRACIÓN: motor de tarifas dinámicas + endurecimiento
-- Para instalaciones que YA tienen datos con el esquema anterior
-- (habitaciones con precio_hora). Instalaciones nuevas NO deben
-- ejecutar esto: basta importar schema.sql + seed.sql.
--
-- Qué hace:
--   1. Crea la tabla `tarifas`.
--   2. habitaciones: agrega precio_hora_extra (hereda precio_hora).
--   3. Genera una tarifa inicial por habitación a partir del
--      precio_hora anterior: "3 horas" = precio_hora × 3, para que
--      el hotel siga operando y el dueño la ajuste a su gusto.
--   4. estancias: agrega tarifa_id, tarifa_nombre y precio_hora_extra
--      (las estancias históricas heredan el precio_hora anterior).
--   5. Elimina habitaciones.precio_hora y mejora índices.
--
-- Ejecutar con el servidor DETENIDO y respaldo previo:
--   mysqldump -u root autohotel_saas > respaldo.sql
--   mysql -u root autohotel_saas < db/migracion_tarifas.sql
-- ============================================================

SET NAMES utf8mb4;
USE autohotel_saas;

-- 1. Tabla de tarifas
CREATE TABLE IF NOT EXISTS tarifas (
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

-- 2. Nueva columna en habitaciones (hereda el precio_hora anterior)
ALTER TABLE habitaciones
  ADD COLUMN precio_hora_extra DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER precio_noche;

UPDATE habitaciones SET precio_hora_extra = precio_hora;

-- 3. Tarifa inicial por habitación: "3 horas" al precio_hora × 3
INSERT INTO tarifas (hotel_id, habitacion_id, nombre, horas, precio)
SELECT hotel_id, id, '3 horas', 3, ROUND(precio_hora * 3, 2)
  FROM habitaciones;

-- 4. Foto de condiciones en estancias
ALTER TABLE estancias
  ADD COLUMN tarifa_id INT UNSIGNED NULL AFTER tipo,
  ADD COLUMN tarifa_nombre VARCHAR(60) NOT NULL DEFAULT '' AFTER tarifa_id,
  ADD COLUMN precio_hora_extra DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER horas_contratadas,
  ADD CONSTRAINT fk_estancias_tarifa FOREIGN KEY (tarifa_id) REFERENCES tarifas (id) ON DELETE SET NULL;

-- Estancias históricas: heredan el precio_hora vigente de su habitación
-- y una descripción legible de lo contratado.
UPDATE estancias e
  JOIN habitaciones h ON h.id = e.habitacion_id
   SET e.precio_hora_extra = h.precio_hora,
       e.tarifa_nombre = IF(e.tipo = 'noche', 'Noche completa', CONCAT(e.horas_contratadas, ' horas'));

-- 5. Fuera la columna vieja + índices mejorados
ALTER TABLE habitaciones DROP COLUMN precio_hora;

ALTER TABLE estancias
  DROP INDEX idx_estancias_habitacion,
  ADD INDEX idx_estancias_habitacion_estado (habitacion_id, estado);

ALTER TABLE reservas
  DROP INDEX idx_reservas_habitacion,
  ADD INDEX idx_reservas_habitacion_estado (habitacion_id, estado, fecha_hora);
