-- ============================================================
-- Migración: cobro de consumos EN CURSO (v2.10). Para
-- instalaciones que ya tienen datos; las nuevas usan schema.sql.
--
-- El recepcionista puede cobrar los pedidos entregados (y el
-- saldo de extras) al momento, sin esperar la salida:
--   - cobros.tipo gana el valor 'consumo'
--   - estancias.total_pedidos_pagado registra la porción de
--     pedidos ya cobrada; la salida liquida solo la diferencia.
-- Las estancias existentes quedan con 0 (nada cobrado en curso):
-- su salida sigue liquidando todo, igual que antes.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE cobros
  MODIFY tipo ENUM('base','salida','consumo') NOT NULL;

ALTER TABLE estancias
  ADD COLUMN total_pedidos_pagado DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total_pedidos;
