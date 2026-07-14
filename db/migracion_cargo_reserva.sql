-- ============================================================
-- Migración: cargo extra en reservas (recargo por reservar y
-- extras como decoración). Para instalaciones que ya tienen
-- datos; las instalaciones nuevas usan schema.sql directamente.
--
-- El cargo se define al crear la reserva y se FOTOGRAFÍA en la
-- estancia al convertirla en entrada (igual que las tarifas):
-- cambios posteriores no alteran cobros en curso.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE reservas
  ADD COLUMN cargo_extra       DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER nota,
  ADD COLUMN cargo_descripcion VARCHAR(200) NOT NULL DEFAULT '' AFTER cargo_extra;

ALTER TABLE estancias
  ADD COLUMN cargo_extra       DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER horas_extra,
  ADD COLUMN cargo_descripcion VARCHAR(200) NOT NULL DEFAULT '' AFTER cargo_extra;
