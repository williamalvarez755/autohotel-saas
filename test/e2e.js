// ============================================================
// Pruebas end-to-end de AutoHotel SaaS.
//
// Requisitos para ejecutarlas:
//   1. Base de datos recién importada:  schema.sql + seed.sql
//   2. Servidor corriendo:              npm start
//   3. Ejecutar:                        node test/e2e.js
//
// La suite ejercita la API real (HTTP) cubriendo TODOS los
// criterios de aceptación: login por rol, suspensión, cambio de
// hotel, aislamiento multi-tenant (incluido el motor de tarifas),
// flujo entrada→cobro→pedido→salida→limpieza, horas extra con
// precio fotografiado, stock, reservas, noche completa, reportes,
// usuarios y pagos de mensualidad. Deja datos de prueba: vuelva
// a importar seed.sql si quiere el sistema limpio después.
// ============================================================

require('dotenv').config();
const mysql = require('mysql2/promise');

const BASE = `http://localhost:${process.env.PORT || 3000}/api`;
const galletas = {}; // usuario -> cookie de sesión

let total = 0;
let exitosas = 0;
const fallas = [];

function probar(nombre, condicion, detalle = '') {
  total += 1;
  if (condicion) {
    exitosas += 1;
    console.log(`  ✔ ${nombre}`);
  } else {
    fallas.push(nombre);
    console.log(`  ✘ ${nombre}${detalle ? ' — ' + detalle : ''}`);
  }
}

async function llamar(usuario, metodo, ruta, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (usuario && galletas[usuario]) headers.Cookie = galletas[usuario];
  const respuesta = await fetch(BASE + ruta, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const setCookie = respuesta.headers.get('set-cookie');
  if (usuario && setCookie) galletas[usuario] = setCookie.split(';')[0];
  const json = await respuesta.json();
  json.status = respuesta.status;
  return json;
}

const ingresar = (usuario, password) =>
  llamar(usuario, 'POST', '/auth/login', { usuario, password: password });

/** Tarifa de una habitación por cantidad de horas (del tablero). */
function tarifaDe(tablero, habitacionId, horas) {
  const habitacion = tablero.data.habitaciones.find((h) => h.id === habitacionId);
  return habitacion ? habitacion.tarifas.find((t) => t.horas === horas) : null;
}

async function principal() {
  const bd = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    dateStrings: true
  });

  console.log('\n=== A. Autenticación y roles ===');
  const admin = await ingresar('admin', 'admin123');
  probar('Login superadmin redirige a /superadmin', admin.success && admin.data.redirect === '/superadmin');
  const carlos = await ingresar('carlos', 'dueno123');
  probar('Login dueño con 2 hoteles', carlos.success && carlos.data.hoteles.length === 2 && carlos.data.redirect === '/app');
  const pedro = await ingresar('pedro', 'trab123');
  probar('Login trabajador redirige a /app', pedro.success && pedro.data.redirect === '/app');
  const malo = await ingresar('pedro2', 'incorrecta');
  probar('Credenciales malas → 401 con mensaje genérico', malo.status === 401 && malo.message === 'Usuario o contraseña incorrectos');
  await ingresar('maria', 'dueno123');

  console.log('\n=== B. Cambio de hotel y aislamiento del dueño ===');
  let tablero = await llamar('carlos', 'GET', '/habitaciones');
  probar('Hotel 1 de carlos muestra H-01', tablero.data.habitaciones.some((h) => h.nombre === 'H-01'));
  await llamar('carlos', 'POST', '/auth/hotel-activo', { hotel_id: 2 });
  tablero = await llamar('carlos', 'GET', '/habitaciones');
  probar('Al cambiar a hotel 2 muestra A-1 y ya no H-01',
    tablero.data.habitaciones.some((h) => h.nombre === 'A-1') && !tablero.data.habitaciones.some((h) => h.nombre === 'H-01'));
  const hotelAjeno = await llamar('carlos', 'POST', '/auth/hotel-activo', { hotel_id: 3 });
  probar('Carlos NO puede activar el hotel de maria (403)', hotelAjeno.status === 403);
  await llamar('carlos', 'POST', '/auth/hotel-activo', { hotel_id: 1 });

  console.log('\n=== C. Motor de tarifas: entrada → cobro → pedido → salida → limpieza ===');
  tablero = await llamar('pedro', 'GET', '/habitaciones');
  const h01 = tablero.data.habitaciones.find((h) => h.id === 1);
  probar('El tablero expone el menú de tarifas de H-01 (Q100/3h y Q160/6h)',
    h01 && h01.tarifas.length === 2 &&
    h01.tarifas.some((t) => t.horas === 3 && Number(t.precio) === 100) &&
    h01.tarifas.some((t) => t.horas === 6 && Number(t.precio) === 160));
  const tarifa3h = tarifaDe(tablero, 1, 3);

  const entrada = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 1, placa: 'e2e-001', tipo: 'horas', tarifa_id: tarifa3h.id });
  probar('Entrada con tarifa "3 horas": total base Q100 y 3 h contratadas',
    entrada.success && entrada.data.total_base === 100 && entrada.data.horas_contratadas === 3 &&
    entrada.data.tarifa_nombre === '3 horas' && Boolean(entrada.data.hora_salida_prevista));
  const estanciaId = entrada.data.id;

  const sinTarifa = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 4, placa: 'e2e-x', tipo: 'horas' });
  probar('Entrada por horas SIN tarifa se rechaza (400)', !sinTarifa.success && sinTarifa.status === 400);
  const tarifaAjena = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 4, placa: 'e2e-x', tipo: 'horas', tarifa_id: tarifa3h.id });
  probar('AISLAMIENTO: tarifa de otra habitación no aplica (404)', tarifaAjena.status === 404);

  tablero = await llamar('pedro', 'GET', '/habitaciones');
  const h01Ocupada = tablero.data.habitaciones.find((h) => h.id === 1);
  probar('H-01 quedó OCUPADA en el tablero con su tarifa', h01Ocupada.estado === 'ocupada' &&
    h01Ocupada.placa === 'E2E-001' && h01Ocupada.tarifa_nombre === '3 horas');

  const pago = await llamar('pedro', 'POST', `/estancias/${estanciaId}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 200 });
  probar('Cobro base en efectivo con cambio Q100', pago.success && pago.data.cambio === 100);
  const pagoDoble = await llamar('pedro', 'POST', `/estancias/${estanciaId}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 200 });
  probar('No se puede pagar el base dos veces', !pagoDoble.success);
  const tarifa3hH02 = tarifaDe(tablero, 2, 3);
  const pagoCorto = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 2, placa: 'e2e-tmp', tipo: 'horas', tarifa_id: tarifa3hH02.id })
    .then((e) => llamar('pedro', 'POST', `/estancias/${e.data.id}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 10 }));
  probar('Efectivo insuficiente en cobro base → error', !pagoCorto.success && pagoCorto.status === 400);

  const pedido = await llamar('pedro', 'POST', `/estancias/${estanciaId}/pedidos`, { producto_id: 3, cantidad: 2 });
  probar('Pedido 2 cervezas: subtotal Q50 y stock descontado a 58',
    pedido.success && pedido.data.subtotal === 50 && pedido.data.stock_restante === 58);
  const pedidoExceso = await llamar('pedro', 'POST', `/estancias/${estanciaId}/pedidos`, { producto_id: 3, cantidad: 999 });
  probar('Stock NUNCA negativo: pedido mayor al stock → error claro',
    !pedidoExceso.success && pedidoExceso.message.includes('Stock insuficiente'));

  const ajena = await llamar('maria', 'GET', `/estancias/${estanciaId}`);
  probar('AISLAMIENTO: maria no ve la estancia de carlos ni con el ID (404)', ajena.status === 404);
  const editAjena = await llamar('maria', 'PUT', '/habitaciones/1', {
    nombre: 'HACK', precio_noche: 1, precio_hora_extra: 1,
    tarifas: [{ nombre: 'hack', horas: 1, precio: 1 }], activo: 1
  });
  probar('AISLAMIENTO: maria no puede editar habitación de carlos (404)', editAjena.status === 404);

  // Simular que el cliente se pasó 30 minutos de sus 3 horas
  await bd.query(
    `UPDATE estancias SET hora_entrada = DATE_SUB(hora_entrada, INTERVAL 210 MINUTE),
        hora_salida_prevista = DATE_SUB(hora_salida_prevista, INTERVAL 210 MINUTE) WHERE id = ?`,
    [estanciaId]
  );
  const alertas = await llamar('pedro', 'GET', '/alertas');
  probar('ALERTA de tiempo excedido aparece', alertas.data.tiempo_excedido.some((a) => a.estancia_id === estanciaId));

  // El dueño sube los precios A MEDIA ESTANCIA: lo pactado no cambia
  const subida = await llamar('carlos', 'PUT', '/habitaciones/1', {
    nombre: 'H-01', precio_noche: 200, precio_hora_extra: 999,
    tarifas: [{ nombre: '3 horas', horas: 3, precio: 100 }, { nombre: '6 horas', horas: 6, precio: 160 }],
    activo: 1
  });
  probar('El dueño puede editar tarifas y precios de su habitación', subida.success);

  const preSalida = await llamar('pedro', 'GET', `/estancias/${estanciaId}/pre-salida`);
  probar('Horas extra redondeadas hacia arriba (30 min → 1 h) al precio FOTOGRAFIADO Q35',
    preSalida.data.horas_extra === 1 && preSalida.data.total_extra === 35,
    `obtenido: ${preSalida.data.horas_extra} h × → Q${preSalida.data.total_extra}`);
  probar('Pre-salida: pendiente = pedidos 50 + extra 35 = Q85 (base ya pagado)',
    preSalida.data.total_pendiente === 85 && preSalida.data.total_final === 185);

  const salida = await llamar('pedro', 'POST', `/estancias/${estanciaId}/salida`, { metodo: 'efectivo', efectivo_recibido: 100 });
  probar('Salida cobra lo pendiente con cambio Q15 y total final Q185',
    salida.success && salida.data.cambio === 15 && salida.data.total_final === 185);
  tablero = await llamar('pedro', 'GET', '/habitaciones');
  probar('H-01 pasó a LIMPIEZA tras la salida', tablero.data.habitaciones.find((h) => h.id === 1).estado === 'limpieza');

  const limpieza = await llamar('pedro', 'GET', '/limpieza');
  probar('H-01 aparece en la lista de limpieza', limpieza.data.some((h) => h.id === 1));
  const limpia = await llamar('pedro', 'POST', '/habitaciones/1/limpia');
  probar('Marcar limpia: LIMPIEZA → DISPONIBLE', limpia.success && limpia.data.estado === 'disponible');

  console.log('\n=== D. Reservas y noche completa ===');
  const reserva = await llamar('pedro', 'POST', '/reservas', { habitacion_id: 3, fecha_hora: '2027-01-01 20:00', placa: 'e2e-res', nota: 'prueba' });
  probar('Crear reserva pasa la habitación a RESERVADA', reserva.success);
  tablero = await llamar('pedro', 'GET', '/habitaciones');
  probar('H-03 en morado (reservada)', tablero.data.habitaciones.find((h) => h.id === 3).estado === 'reservada');
  const tarifa3hH03 = tarifaDe(tablero, 3, 3);
  const entradaDirecta = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 3, placa: 'e2e-x', tipo: 'horas', tarifa_id: tarifa3hH03.id });
  probar('Entrada directa sobre reservada se rechaza', !entradaDirecta.success);
  const convertir = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 3, placa: 'e2e-res', tipo: 'horas', tarifa_id: tarifa3hH03.id, reserva_id: reserva.data.id });
  probar('Convertir reserva en entrada (llega el cliente)', convertir.success);
  const [reservaFila] = await bd.query('SELECT estado FROM reservas WHERE id = ?', [reserva.data.id]);
  probar('La reserva quedó USADA', reservaFila[0].estado === 'usada');
  const salidaSinBase = await llamar('pedro', 'POST', `/estancias/${convertir.data.id}/salida`, { metodo: 'transferencia' });
  probar('Salida liquida el base no pagado (Q100 de la tarifa) por transferencia',
    salidaSinBase.success && salidaSinBase.data.total_pendiente === 100);
  await llamar('pedro', 'POST', '/habitaciones/3/limpia');

  const reserva2 = await llamar('pedro', 'POST', '/reservas', { habitacion_id: 4, fecha_hora: '2027-01-01 20:00' });
  const cancelada = await llamar('pedro', 'POST', `/reservas/${reserva2.data.id}/cancelar`);
  tablero = await llamar('pedro', 'GET', '/habitaciones');
  probar('Cancelar reserva libera la habitación', cancelada.success && tablero.data.habitaciones.find((h) => h.id === 4).estado === 'disponible');
  const reservaPasada = await llamar('pedro', 'POST', '/reservas', { habitacion_id: 4, fecha_hora: '2020-01-01 10:00' });
  probar('Reserva con fecha pasada se rechaza', !reservaPasada.success);

  const noche = await llamar('pedro', 'POST', '/estancias', { habitacion_id: 4, placa: 'e2e-noc', tipo: 'noche' });
  probar('Noche completa: total Q250 y 12 h del hotel (sin tarifa_id)',
    noche.success && noche.data.total_base === 250 && noche.data.horas_contratadas === 12 &&
    noche.data.tarifa_nombre === 'Noche completa');
  const pagoNoche = await llamar('pedro', 'POST', `/estancias/${noche.data.id}/pago-base`, { metodo: 'transferencia' });
  probar('Cobro de noche por transferencia (sin cambio)', pagoNoche.success && pagoNoche.data.cambio === null);
  const salidaNoche = await llamar('pedro', 'POST', `/estancias/${noche.data.id}/salida`, {});
  probar('Salida de noche sin pendiente (todo pagado)', salidaNoche.success && salidaNoche.data.total_pendiente === 0);
  await llamar('pedro', 'POST', '/habitaciones/4/limpia');

  console.log('\n=== E. Dashboard y reportes cuadran con lo cobrado ===');
  // Cobros reales del día: base H-01 (100) + salida H-01 (35 extra + 50 pedidos)
  // + salida H-03 (100 base liquidado) + base noche H-04 (250) = Q535.
  // La estancia de H-02 sigue activa y sin pagar (su cobro falló a propósito).
  const dashboard = await llamar('carlos', 'GET', '/dashboard');
  probar('Dashboard: ingresos del día = Q535 (100+85+100+250)', dashboard.data.ingresos_dia.total === 535,
    `obtenido: ${dashboard.data.ingresos_dia.total}`);
  probar('Dashboard: desglose habitaciones Q485 y pedidos Q50',
    dashboard.data.ingresos_dia.habitaciones === 485 && dashboard.data.ingresos_dia.pedidos === 50);
  probar('Dashboard: clientes del día = 4 estancias', dashboard.data.clientes_dia === 4);

  const hoy = new Date(Date.now() - 6 * 3600 * 1000).toISOString().slice(0, 10);
  const porDia = await llamar('carlos', 'GET', `/reportes/ingresos-dia?desde=${hoy}&hasta=${hoy}`);
  probar('Reporte ingresos por día cuadra con el dashboard', porDia.data.totales.total === 535);
  const porHabitacion = await llamar('carlos', 'GET', `/reportes/ingresos-habitacion?desde=${hoy}&hasta=${hoy}`);
  const filaH01 = porHabitacion.data.find((h) => h.nombre === 'H-01');
  probar('Reporte por habitación: H-01 = Q185 (135 habitación + 50 pedidos)',
    filaH01 && Number(filaH01.total) === 185);
  const vendidos = await llamar('carlos', 'GET', `/reportes/productos-vendidos?desde=${hoy}&hasta=${hoy}`);
  probar('Productos más vendidos: 2 cervezas por Q50',
    vendidos.data.length === 1 && Number(vendidos.data[0].unidades) === 2 && Number(vendidos.data[0].total) === 50);
  const rangoMalo = await llamar('carlos', 'GET', '/reportes/ingresos-dia?desde=2026-12-31&hasta=2026-01-01');
  probar('Rango de fechas invertido se rechaza', !rangoMalo.success);

  console.log('\n=== F. Tarifas: validaciones del dueño ===');
  const sinTarifas = await llamar('carlos', 'POST', '/habitaciones', {
    nombre: 'E2E-HAB', precio_noche: 100, precio_hora_extra: 20, tarifas: []
  });
  probar('Habitación sin tarifas se rechaza (400)', !sinTarifas.success && sinTarifas.status === 400);
  const tarifaMala = await llamar('carlos', 'POST', '/habitaciones', {
    nombre: 'E2E-HAB', precio_noche: 100, precio_hora_extra: 20,
    tarifas: [{ nombre: 'rota', horas: 0, precio: 50 }]
  });
  probar('Tarifa con 0 horas se rechaza (400)', !tarifaMala.success && tarifaMala.status === 400);
  const tarifaDuplicada = await llamar('carlos', 'POST', '/habitaciones', {
    nombre: 'E2E-HAB', precio_noche: 100, precio_hora_extra: 20,
    tarifas: [{ nombre: 'Rato', horas: 2, precio: 50 }, { nombre: 'rato', horas: 3, precio: 70 }]
  });
  probar('Tarifas con nombre repetido se rechazan (400)', !tarifaDuplicada.success && tarifaDuplicada.status === 400);
  const habNueva = await llamar('carlos', 'POST', '/habitaciones', {
    nombre: 'E2E-HAB', precio_noche: 150, precio_hora_extra: 25,
    tarifas: [{ nombre: '2 horas', horas: 2, precio: 60 }, { nombre: '4 horas', horas: 4, precio: 100 }]
  });
  probar('Habitación nueva con menú de 2 tarifas', habNueva.success);
  const admin1 = await llamar('carlos', 'GET', '/habitaciones/admin');
  const habNuevaAdmin = admin1.data.find((h) => h.nombre === 'E2E-HAB');
  probar('El menú de tarifas queda guardado y se lista en administración',
    habNuevaAdmin && habNuevaAdmin.tarifas.length === 2 &&
    Number(habNuevaAdmin.precio_hora_extra) === 25);

  console.log('\n=== G. Permisos del trabajador en inventario y módulos ===');
  const reporteProhibido = await llamar('pedro', 'GET', `/reportes/ingresos-dia?desde=${hoy}&hasta=${hoy}`);
  probar('Trabajador NO ve reportes (403)', reporteProhibido.status === 403);
  const usuariosProhibido = await llamar('pedro', 'GET', '/usuarios');
  probar('Trabajador NO ve usuarios (403)', usuariosProhibido.status === 403);
  const editarProhibido = await llamar('pedro', 'PUT', '/productos/3', { nombre: 'x', precio: 1, stock_minimo: 1, activo: 1 });
  probar('Trabajador NO edita precios (403)', editarProhibido.status === 403);
  const ajusteProhibido = await llamar('pedro', 'POST', '/productos/3/ajuste', { direccion: 'restar', cantidad: 1, motivo: 'x' });
  probar('Trabajador NO hace ajustes negativos (403)', ajusteProhibido.status === 403);
  const habitacionProhibida = await llamar('pedro', 'POST', '/habitaciones', {
    nombre: 'HACK-TRAB', precio_noche: 1, precio_hora_extra: 1,
    tarifas: [{ nombre: '1 hora', horas: 1, precio: 1 }]
  });
  probar('Trabajador NO crea habitaciones ni tarifas (403)', habitacionProhibida.status === 403);

  const productoNuevo = await llamar('pedro', 'POST', '/productos', { nombre: 'Producto E2E', stock: 10 });
  probar('Trabajador SÍ crea producto (precio Q0 para que el dueño confirme)', productoNuevo.success);
  const mercaderia = await llamar('pedro', 'POST', '/productos/1/entrada', { cantidad: 24, motivo: 'Camión E2E' });
  probar('Trabajador SÍ registra ingreso de mercadería (48+24=72)', mercaderia.success && mercaderia.data.stock === 72);
  const movimientos = await llamar('carlos', 'GET', '/productos/movimientos');
  const movimientoAuditado = movimientos.data.find((m) => m.motivo === 'Camión E2E');
  probar('El movimiento queda auditado con el usuario que lo hizo',
    Boolean(movimientoAuditado) && movimientoAuditado.usuario_nombre === 'Pedro García');
  const precioConfirmado = await llamar('carlos', 'PUT', `/productos/${productoNuevo.data.id}`, { nombre: 'Producto E2E', precio: 12.5, stock_minimo: 3, activo: 1 });
  probar('Dueño confirma el precio del producto nuevo', precioConfirmado.success);
  const ajusteExceso = await llamar('carlos', 'POST', `/productos/${productoNuevo.data.id}/ajuste`, { direccion: 'restar', cantidad: 9999, motivo: 'prueba' });
  probar('Ajuste que dejaría stock negativo se rechaza', !ajusteExceso.success);

  console.log('\n=== H. Usuarios del dueño ===');
  const trabajadorNuevo = await llamar('carlos', 'POST', '/usuarios', { nombre: 'Trabajador E2E', usuario: 'e2e.trab', password: 'e2e123', hotel_id: 2 });
  probar('Dueño crea trabajador en SU hotel', trabajadorNuevo.success);
  const trabajadorAjeno = await llamar('carlos', 'POST', '/usuarios', { nombre: 'Espía', usuario: 'e2e.espia', password: 'e2e123', hotel_id: 3 });
  probar('Dueño NO crea trabajadores en hotel ajeno (403)', trabajadorAjeno.status === 403);
  await llamar('carlos', 'PUT', '/usuarios/5/activo', { activo: 0 });
  const luciaBloqueada = await ingresar('lucia', 'trab123');
  probar('Trabajador desactivado no puede entrar', luciaBloqueada.status === 403 && luciaBloqueada.message.includes('desactivado'));
  const sabotaje = await llamar('maria', 'PUT', '/usuarios/4/activo', { activo: 0 });
  probar('Maria NO puede tocar trabajadores de carlos (404)', sabotaje.status === 404);
  await llamar('carlos', 'PUT', '/usuarios/5/activo', { activo: 1 });
  const luciaVuelve = await ingresar('lucia', 'trab123');
  probar('Trabajador reactivado entra de nuevo', luciaVuelve.success);

  console.log('\n=== I. Suscripciones: suspensión, vencimiento y pago ===');
  await llamar('admin', 'POST', '/superadmin/duenos/2/suspender');
  const pedroBloqueado = await llamar('pedro', 'GET', '/habitaciones');
  probar('Suspensión expulsa al trabajador con sesión abierta',
    pedroBloqueado.status === 403 && pedroBloqueado.message === 'Servicio suspendido, comuníquese con el proveedor');
  const carlosBloqueado = await ingresar('carlos', 'dueno123');
  probar('El dueño suspendido no puede iniciar sesión (mensaje exacto)',
    carlosBloqueado.status === 403 && carlosBloqueado.message === 'Servicio suspendido, comuníquese con el proveedor');

  const [antes] = await bd.query('SELECT fecha_vencimiento FROM suscripciones WHERE dueno_id = 2');
  const pagoMensual = await llamar('admin', 'POST', '/superadmin/duenos/2/pagos', { monto: 500, nota: 'Pago E2E' });
  probar('Registrar pago reactiva y extiende el vencimiento',
    pagoMensual.success && pagoMensual.data.nueva_fecha_vencimiento > String(antes[0].fecha_vencimiento).slice(0, 10));
  const carlosVuelve = await ingresar('carlos', 'dueno123');
  probar('El dueño entra de nuevo tras el pago', carlosVuelve.success);
  const historial = await llamar('admin', 'GET', '/superadmin/duenos/2/pagos');
  probar('El pago queda en el historial', historial.data.pagos.some((p) => p.nota === 'Pago E2E'));

  await bd.query(`UPDATE suscripciones SET fecha_vencimiento = '2020-01-01' WHERE dueno_id = 3`);
  const anaVencida = await ingresar('ana', 'trab123');
  probar('Vencimiento pasado bloquea automáticamente a los trabajadores del dueño',
    anaVencida.status === 403 && anaVencida.message.includes('suspendido'));
  const duenos = await llamar('admin', 'GET', '/superadmin/duenos');
  probar('El superadmin ve a maria como VENCIDA',
    duenos.data.find((d) => d.usuario === 'maria').estado_calculado === 'vencida');
  await bd.query(`UPDATE suscripciones SET fecha_vencimiento = DATE(UTC_TIMESTAMP() - INTERVAL 6 HOUR) + INTERVAL 30 DAY WHERE dueno_id = 3`);

  console.log('\n=== J. Superadmin: dueños y hoteles ===');
  const duenoNuevo = await llamar('admin', 'POST', '/superadmin/duenos', { nombre: 'Dueño E2E', usuario: 'e2e.dueno', password: 'e2e123' });
  probar('Superadmin crea dueño con suscripción inicial', duenoNuevo.success);
  const hotelNuevo = await llamar('admin', 'POST', '/superadmin/hoteles', { dueno_id: duenoNuevo.data.id, nombre: 'Hotel E2E', direccion: 'Prueba' });
  probar('Superadmin crea hotel y lo asigna', hotelNuevo.success);
  const duenoNuevoLogin = await ingresar('e2e.dueno', 'e2e123');
  probar('El dueño nuevo entra y ve su hotel', duenoNuevoLogin.success && duenoNuevoLogin.data.hoteles.length === 1);

  // El hotel 1 tiene una estancia activa (e2e-tmp en H-02): no puede desactivarse
  const desactivarConActivas = await llamar('admin', 'PUT', '/superadmin/hoteles/1', {
    nombre: 'AutoHotel El Paraíso', direccion: 'Km 12.5 Carretera a El Salvador, Guatemala',
    minutos_alerta_limpieza: 30, horas_noche: 12, activo: 0
  });
  probar('No se puede desactivar un hotel con estancias activas',
    !desactivarConActivas.success && desactivarConActivas.message.includes('estancia'));

  // La sesión anterior de pedro fue destruida al suspender a carlos
  // (comportamiento correcto): inicia sesión de nuevo para probar el rol.
  await ingresar('pedro', 'trab123');
  const superadminProhibido = await llamar('pedro', 'GET', '/superadmin/duenos');
  probar('Un trabajador no accede a rutas del superadmin (403)', superadminProhibido.status === 403);

  console.log('\n=== K. Cargo de reserva (recargo + extras) ===');
  // Habitación disponible del hotel activo de carlos con tarifas
  const tableroK = await llamar('carlos', 'GET', '/habitaciones');
  const libreK = tableroK.data.habitaciones.find((h) => h.estado === 'disponible' && h.tarifas.length);
  probar('Hay habitación disponible para probar el cargo de reserva', Boolean(libreK));

  const cargoNegativo = await llamar('carlos', 'POST', '/reservas', {
    habitacion_id: libreK.id, fecha_hora: '2030-01-01 20:00', cargo_extra: -5
  });
  probar('Cargo negativo en la reserva es rechazado (400)', cargoNegativo.status === 400);

  const reservaCargo = await llamar('carlos', 'POST', '/reservas', {
    habitacion_id: libreK.id, fecha_hora: '2030-01-01 20:00', placa: 'E2E-CARGO',
    cargo_extra: 75.5, cargo_descripcion: 'Decoración con globos'
  });
  probar('Se crea reserva con cargo adicional', reservaCargo.success);

  const pendientesK = await llamar('carlos', 'GET', '/reservas');
  const reservaK = pendientesK.data.pendientes.find((r) => r.id === reservaCargo.data.id);
  probar('La reserva lista su cargo y descripción',
    Boolean(reservaK) && Number(reservaK.cargo_extra) === 75.5 && reservaK.cargo_descripcion === 'Decoración con globos');

  const tarifaK = libreK.tarifas[0];
  const entradaK = await llamar('carlos', 'POST', '/estancias', {
    habitacion_id: libreK.id, placa: 'E2E-CARGO', tipo: 'horas',
    tarifa_id: tarifaK.id, reserva_id: reservaCargo.data.id
  });
  const totalEsperadoK = Math.round((Number(tarifaK.precio) + 75.5) * 100) / 100;
  probar('La entrada fotografía el cargo de la reserva',
    entradaK.success && Number(entradaK.data.cargo_extra) === 75.5
    && Number(entradaK.data.total_cobro_base) === totalEsperadoK);

  const pagoCortoK = await llamar('carlos', 'POST', `/estancias/${entradaK.data.id}/pago-base`, {
    metodo: 'efectivo', efectivo_recibido: Number(tarifaK.precio)
  });
  probar('El cobro base exige tarifa + cargo (efectivo corto → 400)', pagoCortoK.status === 400);

  const pagoOkK = await llamar('carlos', 'POST', `/estancias/${entradaK.data.id}/pago-base`, {
    metodo: 'efectivo', efectivo_recibido: totalEsperadoK + 20
  });
  probar('Cobro base incluye el cargo y devuelve el cambio correcto',
    pagoOkK.success && Number(pagoOkK.data.total) === totalEsperadoK && Number(pagoOkK.data.cambio) === 20);

  const preSalidaK = await llamar('carlos', 'GET', `/estancias/${entradaK.data.id}/pre-salida`);
  probar('Pre-salida muestra el cargo y no queda pendiente tras el cobro base',
    preSalidaK.success && Number(preSalidaK.data.cargo_extra) === 75.5
    && Number(preSalidaK.data.total_pendiente) === 0);

  const salidaK = await llamar('carlos', 'POST', `/estancias/${entradaK.data.id}/salida`, {});
  probar('La salida cierra con total final = tarifa + cargo',
    salidaK.success && Number(salidaK.data.total_final) === totalEsperadoK);

  const [cobrosK] = await bd.query(
    'SELECT COALESCE(SUM(monto_total), 0) AS suma FROM cobros WHERE estancia_id = ?',
    [entradaK.data.id]
  );
  probar('El libro de cobros cuadra con el total (tarifa + cargo)',
    Number(cobrosK[0].suma) === totalEsperadoK);
  await llamar('carlos', 'POST', `/habitaciones/${libreK.id}/limpia`); // deja la habitación disponible

  console.log('\n=== L. Eliminación definitiva de dueños ===');
  const eliminarSinConfirmar = await llamar('admin', 'DELETE', `/superadmin/duenos/${duenoNuevo.data.id}`, {});
  probar('Eliminar sin confirmación es rechazado (400)', eliminarSinConfirmar.status === 400);

  const eliminarMalConfirmado = await llamar('admin', 'DELETE', `/superadmin/duenos/${duenoNuevo.data.id}`, {
    confirmar_usuario: 'otro.usuario'
  });
  probar('Confirmación con usuario equivocado es rechazada (400)', eliminarMalConfirmado.status === 400);

  // Carlos (dueño 2) tiene una estancia activa en su hotel: no se puede eliminar
  const eliminarConActivas = await llamar('admin', 'DELETE', '/superadmin/duenos/2', {
    confirmar_usuario: 'carlos'
  });
  probar('No se elimina un dueño con estancias activas sin liquidar',
    !eliminarConActivas.success && eliminarConActivas.message.includes('activa'));

  const eliminarComoTrabajador = await llamar('pedro', 'DELETE', `/superadmin/duenos/${duenoNuevo.data.id}`, {
    confirmar_usuario: 'e2e.dueno'
  });
  probar('Un trabajador no puede eliminar dueños (403)', eliminarComoTrabajador.status === 403);

  const eliminarOk = await llamar('admin', 'DELETE', `/superadmin/duenos/${duenoNuevo.data.id}`, {
    confirmar_usuario: 'e2e.dueno'
  });
  probar('El superadmin elimina al dueño moroso con su jerarquía completa',
    eliminarOk.success && eliminarOk.data.hoteles_eliminados === 1);

  const duenosTrasEliminar = await llamar('admin', 'GET', '/superadmin/duenos');
  probar('El dueño eliminado desaparece del listado',
    !duenosTrasEliminar.data.some((d) => d.usuario === 'e2e.dueno'));

  const loginEliminado = await ingresar('e2e.dueno', 'e2e123');
  probar('El dueño eliminado ya no puede iniciar sesión', !loginEliminado.success);

  await bd.end();

  console.log('\n============================================');
  console.log(`Resultado: ${exitosas}/${total} pruebas exitosas`);
  if (fallas.length) {
    console.log('FALLARON:');
    fallas.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('TODAS LAS PRUEBAS PASARON ✔');
}

principal().catch((error) => {
  console.error('Error ejecutando las pruebas:', error);
  process.exit(1);
});
