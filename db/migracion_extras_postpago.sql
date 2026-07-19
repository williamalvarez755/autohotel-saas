-- ============================================================
-- Migración: extras agregados DESPUÉS de pagar el cobro base
-- (v2.9). Para instalaciones que ya tienen datos; las nuevas
-- usan schema.sql directamente.
--
-- cargo_extra_pagado = porción del cargo adicional que ya se
-- cobró junto con el base. Si después se agrega otro extra
-- (ej. el cliente pide el jacuzzi ya pagado el base), la
-- diferencia (cargo_extra - cargo_extra_pagado) queda como
-- saldo pendiente y se liquida en la salida por la tubería de
-- cobros existente.
-- ============================================================

SET NAMES utf8mb4;

ALTER TABLE estancias
  ADD COLUMN cargo_extra_pagado DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER cargo_descripcion;

-- En los datos existentes, todo cargo adicional de una estancia con
-- base pagado se cobró en ese mismo cobro: queda saldado.
UPDATE estancias SET cargo_extra_pagado = cargo_extra WHERE pagado_base = 1;
