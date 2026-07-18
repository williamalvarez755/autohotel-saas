-- ============================================================
-- AutoHotel SaaS - Datos de prueba
-- Importar DESPUÉS de schema.sql
--
-- Usuarios de prueba (usuario / contraseña):
--   admin  / admin123   (superadmin)
--   carlos / dueno123   (dueño con 2 hoteles)
--   maria  / dueno123   (dueña con 1 hotel)
--   pedro  / trab123    (trabajador, AutoHotel El Paraíso)
--   lucia  / trab123    (trabajadora, AutoHotel El Paraíso)
--   jorge  / trab123    (trabajador, AutoHotel Luna Azul)
--   ana    / trab123    (trabajadora, AutoHotel Las Palmas)
-- ============================================================

USE autohotel_saas;

-- El archivo está en UTF-8: fuerza el charset de la conexión para
-- que los acentos se guarden bien sin importar la consola usada.
SET NAMES utf8mb4;

SET @ahora = UTC_TIMESTAMP() - INTERVAL 6 HOUR; -- hora de Guatemala

-- ---------- Usuarios: superadmin y dueños ----------
INSERT INTO usuarios (id, rol, nombre, usuario, password_hash, dueno_id, hotel_id, activo, creado_en) VALUES
  (1, 'superadmin', 'Administrador del Sistema', 'admin',  '$2b$10$ezRptZf3Nx892QjrYVI0EeVVKhvdoWl.Pd3illg1JBxqdOM9Ng5I2', NULL, NULL, 1, @ahora),
  (2, 'dueno',      'Carlos Méndez',             'carlos', '$2b$10$ZXHGHCv54BqBh6aiQ/3tEeZnRFGd7cka8YP.wJRRw3oh/bCKU9Yl.', NULL, NULL, 1, @ahora),
  (3, 'dueno',      'María López',               'maria',  '$2b$10$ZXHGHCv54BqBh6aiQ/3tEeZnRFGd7cka8YP.wJRRw3oh/bCKU9Yl.', NULL, NULL, 1, @ahora);

-- ---------- Hoteles ----------
INSERT INTO hoteles (id, dueno_id, nombre, direccion, minutos_alerta_limpieza, horas_noche, activo, creado_en) VALUES
  (1, 2, 'AutoHotel El Paraíso',  'Km 12.5 Carretera a El Salvador, Guatemala', 30, 12, 1, @ahora),
  (2, 2, 'AutoHotel Luna Azul',   'Zona 12, Ciudad de Guatemala',               30, 12, 1, @ahora),
  (3, 3, 'AutoHotel Las Palmas',  'Km 30 Carretera al Pacífico, Amatitlán',     30, 12, 1, @ahora);

-- ---------- Trabajadores ----------
INSERT INTO usuarios (id, rol, nombre, usuario, password_hash, dueno_id, hotel_id, activo, creado_en) VALUES
  (4, 'trabajador', 'Pedro García',   'pedro', '$2b$10$oAusAg1ICbaX9aHzN.AJ8eB3hKlMFQPmVSDxggADoFK5RiDwzokcS', 2, 1, 1, @ahora),
  (5, 'trabajador', 'Lucía Ramírez',  'lucia', '$2b$10$oAusAg1ICbaX9aHzN.AJ8eB3hKlMFQPmVSDxggADoFK5RiDwzokcS', 2, 1, 1, @ahora),
  (6, 'trabajador', 'Jorge Castillo', 'jorge', '$2b$10$oAusAg1ICbaX9aHzN.AJ8eB3hKlMFQPmVSDxggADoFK5RiDwzokcS', 2, 2, 1, @ahora),
  (7, 'trabajador', 'Ana Morales',    'ana',   '$2b$10$oAusAg1ICbaX9aHzN.AJ8eB3hKlMFQPmVSDxggADoFK5RiDwzokcS', 3, 3, 1, @ahora);

-- ---------- Ficha de contacto de los propietarios ----------
UPDATE usuarios SET dpi = '2547 88213 0101', nit = '4581235-6', telefono = '5012-8890',
  correo = 'carlos.mendez@correo.com', direccion = 'Zona 10, Ciudad de Guatemala',
  observaciones = 'Propietario de dos autohoteles. Cliente desde el inicio.'
  WHERE usuario = 'carlos';
UPDATE usuarios SET dpi = '1988 45120 0108', nit = 'CF', telefono = '4478-1200',
  correo = 'maria.lopez@correo.com', direccion = 'Amatitlán, Guatemala',
  observaciones = 'Un autohotel en la carretera al Pacífico.'
  WHERE usuario = 'maria';

-- ---------- Suscripciones (vencen en 30 días a partir de hoy) ----------
INSERT INTO suscripciones (dueno_id, estado, fecha_vencimiento, actualizado_en) VALUES
  (2, 'activa', DATE(@ahora) + INTERVAL 30 DAY, @ahora),
  (3, 'activa', DATE(@ahora) + INTERVAL 30 DAY, @ahora);

-- ---------- Pagos históricos de mensualidad ----------
INSERT INTO pagos_servicio (dueno_id, monto, fecha_pago, mes_correspondiente, nota, registrado_por) VALUES
  (2, 500.00, @ahora, DATE_FORMAT(@ahora, '%Y-%m'), 'Pago inicial del servicio', 1),
  (3, 350.00, @ahora, DATE_FORMAT(@ahora, '%Y-%m'), 'Pago inicial del servicio', 1);

-- ---------- Habitaciones: 8 por hotel, precios en quetzales ----------
-- precio_noche = paquete de noche (dura horas_noche del hotel)
-- precio_hora_extra = tarifa por hora excedida sobre la salida prevista
INSERT INTO habitaciones (id, hotel_id, nombre, estado, precio_noche, precio_hora_extra, activo) VALUES
  -- AutoHotel El Paraíso
  (1,  1, 'H-01',    'disponible', 200.00, 35.00, 1),
  (2,  1, 'H-02',    'disponible', 200.00, 35.00, 1),
  (3,  1, 'H-03',    'disponible', 200.00, 35.00, 1),
  (4,  1, 'H-04',    'disponible', 250.00, 45.00, 1),
  (5,  1, 'H-05',    'disponible', 250.00, 45.00, 1),
  (6,  1, 'H-06',    'disponible', 250.00, 45.00, 1),
  (7,  1, 'Suite 1', 'disponible', 350.00, 60.00, 1),
  (8,  1, 'Suite 2', 'disponible', 350.00, 60.00, 1),
  -- AutoHotel Luna Azul
  (9,  2, 'A-1', 'disponible', 175.00, 30.00, 1),
  (10, 2, 'A-2', 'disponible', 175.00, 30.00, 1),
  (11, 2, 'A-3', 'disponible', 175.00, 30.00, 1),
  (12, 2, 'A-4', 'disponible', 175.00, 30.00, 1),
  (13, 2, 'B-1', 'disponible', 225.00, 40.00, 1),
  (14, 2, 'B-2', 'disponible', 225.00, 40.00, 1),
  (15, 2, 'B-3', 'disponible', 225.00, 40.00, 1),
  (16, 2, 'B-4', 'disponible', 225.00, 40.00, 1),
  -- AutoHotel Las Palmas
  (17, 3, '101', 'disponible', 180.00, 30.00, 1),
  (18, 3, '102', 'disponible', 180.00, 30.00, 1),
  (19, 3, '103', 'disponible', 180.00, 30.00, 1),
  (20, 3, '104', 'disponible', 180.00, 30.00, 1),
  (21, 3, '201', 'disponible', 240.00, 40.00, 1),
  (22, 3, '202', 'disponible', 240.00, 40.00, 1),
  (23, 3, '203', 'disponible', 240.00, 40.00, 1),
  (24, 3, '204', 'disponible', 240.00, 40.00, 1);

-- ---------- Tarifas por tiempo (motor de tarifas dinámicas) ----------
-- Cada hotel define su propia relación precio/tiempo por habitación:
--   El Paraíso vende paquetes de 3 y 6 horas
--   Luna Azul vende paquetes de 3 y 5 horas
--   Las Palmas vende paquetes de 3 y 4 horas
INSERT INTO tarifas (hotel_id, habitacion_id, nombre, horas, precio) VALUES
  -- El Paraíso · estándar (H-01 a H-03): Q100/3h · Q160/6h
  (1, 1, '3 horas', 3, 100.00), (1, 1, '6 horas', 6, 160.00),
  (1, 2, '3 horas', 3, 100.00), (1, 2, '6 horas', 6, 160.00),
  (1, 3, '3 horas', 3, 100.00), (1, 3, '6 horas', 6, 160.00),
  -- El Paraíso · superior (H-04 a H-06): Q125/3h · Q200/6h
  (1, 4, '3 horas', 3, 125.00), (1, 4, '6 horas', 6, 200.00),
  (1, 5, '3 horas', 3, 125.00), (1, 5, '6 horas', 6, 200.00),
  (1, 6, '3 horas', 3, 125.00), (1, 6, '6 horas', 6, 200.00),
  -- El Paraíso · suites: Q175/3h · Q280/6h
  (1, 7, '3 horas', 3, 175.00), (1, 7, '6 horas', 6, 280.00),
  (1, 8, '3 horas', 3, 175.00), (1, 8, '6 horas', 6, 280.00),
  -- Luna Azul · sector A: Q90/3h · Q140/5h
  (2, 9,  '3 horas', 3, 90.00),  (2, 9,  '5 horas', 5, 140.00),
  (2, 10, '3 horas', 3, 90.00),  (2, 10, '5 horas', 5, 140.00),
  (2, 11, '3 horas', 3, 90.00),  (2, 11, '5 horas', 5, 140.00),
  (2, 12, '3 horas', 3, 90.00),  (2, 12, '5 horas', 5, 140.00),
  -- Luna Azul · sector B: Q110/3h · Q170/5h
  (2, 13, '3 horas', 3, 110.00), (2, 13, '5 horas', 5, 170.00),
  (2, 14, '3 horas', 3, 110.00), (2, 14, '5 horas', 5, 170.00),
  (2, 15, '3 horas', 3, 110.00), (2, 15, '5 horas', 5, 170.00),
  (2, 16, '3 horas', 3, 110.00), (2, 16, '5 horas', 5, 170.00),
  -- Las Palmas · planta baja: Q95/3h · Q120/4h
  (3, 17, '3 horas', 3, 95.00),  (3, 17, '4 horas', 4, 120.00),
  (3, 18, '3 horas', 3, 95.00),  (3, 18, '4 horas', 4, 120.00),
  (3, 19, '3 horas', 3, 95.00),  (3, 19, '4 horas', 4, 120.00),
  (3, 20, '3 horas', 3, 95.00),  (3, 20, '4 horas', 4, 120.00),
  -- Las Palmas · planta alta: Q120/3h · Q150/4h
  (3, 21, '3 horas', 3, 120.00), (3, 21, '4 horas', 4, 150.00),
  (3, 22, '3 horas', 3, 120.00), (3, 22, '4 horas', 4, 150.00),
  (3, 23, '3 horas', 3, 120.00), (3, 23, '4 horas', 4, 150.00),
  (3, 24, '3 horas', 3, 120.00), (3, 24, '4 horas', 4, 150.00);

-- ---------- Productos: 10 típicos por hotel ----------
INSERT INTO productos (hotel_id, nombre, precio, stock, stock_minimo, activo, creado_en) VALUES
  -- AutoHotel El Paraíso
  (1, 'Agua pura 600ml',        10.00, 48, 12, 1, @ahora),
  (1, 'Gaseosa lata',           15.00, 36, 12, 1, @ahora),
  (1, 'Cerveza nacional',       25.00, 60, 24, 1, @ahora),
  (1, 'Cerveza importada',      35.00, 24, 12, 1, @ahora),
  (1, 'Boquitas surtidas',      20.00, 30, 10, 1, @ahora),
  (1, 'Preservativos (3 uds)',  25.00, 40, 15, 1, @ahora),
  (1, 'Bebida energizante',     20.00, 24, 10, 1, @ahora),
  (1, 'Cigarros (cajetilla)',   45.00, 20, 8,  1, @ahora),
  (1, 'Kit de higiene',         15.00, 25, 10, 1, @ahora),
  (1, 'Chocolates',             18.00, 20, 8,  1, @ahora),
  -- AutoHotel Luna Azul
  (2, 'Agua pura 600ml',        10.00, 40, 12, 1, @ahora),
  (2, 'Gaseosa lata',           15.00, 30, 12, 1, @ahora),
  (2, 'Cerveza nacional',       25.00, 48, 24, 1, @ahora),
  (2, 'Cerveza importada',      35.00, 18, 12, 1, @ahora),
  (2, 'Boquitas surtidas',      20.00, 25, 10, 1, @ahora),
  (2, 'Preservativos (3 uds)',  25.00, 35, 15, 1, @ahora),
  (2, 'Bebida energizante',     20.00, 20, 10, 1, @ahora),
  (2, 'Cigarros (cajetilla)',   45.00, 15, 8,  1, @ahora),
  (2, 'Kit de higiene',         15.00, 20, 10, 1, @ahora),
  (2, 'Chocolates',             18.00, 15, 8,  1, @ahora),
  -- AutoHotel Las Palmas
  (3, 'Agua pura 600ml',        10.00, 45, 12, 1, @ahora),
  (3, 'Gaseosa lata',           15.00, 32, 12, 1, @ahora),
  (3, 'Cerveza nacional',       25.00, 50, 24, 1, @ahora),
  (3, 'Cerveza importada',      35.00, 20, 12, 1, @ahora),
  (3, 'Boquitas surtidas',      20.00, 28, 10, 1, @ahora),
  (3, 'Preservativos (3 uds)',  25.00, 38, 15, 1, @ahora),
  (3, 'Bebida energizante',     20.00, 22, 10, 1, @ahora),
  (3, 'Cigarros (cajetilla)',   45.00, 18, 8,  1, @ahora),
  (3, 'Kit de higiene',         15.00, 22, 10, 1, @ahora),
  (3, 'Chocolates',             18.00, 18, 8,  1, @ahora);
