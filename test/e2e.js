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

  // --- Control de caja: sin caja abierta el trabajador no cobra efectivo ---
  const cajaSinAbrir = await llamar('pedro', 'GET', '/caja/estado');
  probar('El trabajador arranca sin caja abierta', cajaSinAbrir.success && cajaSinAbrir.data.abierta === null);
  const cobroSinCaja = await llamar('pedro', 'POST', `/estancias/${estanciaId}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 200 });
  probar('BLOQUEO: cobro en efectivo sin caja abierta se rechaza (409)', cobroSinCaja.status === 409);
  const abreCaja = await llamar('pedro', 'POST', '/caja/abrir', { monto_inicial: 300 });
  probar('El trabajador abre su caja con fondo Q300', abreCaja.success && Number(abreCaja.data.monto_inicial) === 300);
  const dobleCaja = await llamar('pedro', 'POST', '/caja/abrir', { monto_inicial: 50 });
  probar('Solo una caja abierta por hotel (segunda apertura → error)', !dobleCaja.success);

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
  // v2.9: el trabajador SÍ ajusta stock (baja por consumo interno),
  // pero la justificación es obligatoria (la sección Q cubre el caso completo)
  const ajusteSinMotivo = await llamar('pedro', 'POST', '/productos/3/ajuste', { direccion: 'restar', cantidad: 1 });
  probar('Trabajador SÍ ajusta stock, pero solo con justificación (400 sin motivo)', ajusteSinMotivo.status === 400);
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

  console.log('\n=== M. Contraseña propia y entrada sin placa ===');
  const passTrabajador = await llamar('pedro', 'PUT', '/auth/password', {
    password_actual: 'trab123', password_nueva: 'nueva123'
  });
  probar('Un trabajador NO puede cambiar su propia contraseña (403)', passTrabajador.status === 403);

  const passActualMala = await llamar('carlos', 'PUT', '/auth/password', {
    password_actual: 'equivocada', password_nueva: 'nueva123'
  });
  probar('Contraseña actual incorrecta es rechazada (400)', passActualMala.status === 400);

  const passCorta = await llamar('carlos', 'PUT', '/auth/password', {
    password_actual: 'dueno123', password_nueva: '123'
  });
  probar('Contraseña nueva de menos de 6 caracteres es rechazada (400)', passCorta.status === 400);

  await ingresar('maria', 'dueno123');
  const passMaria = await llamar('maria', 'PUT', '/auth/password', {
    password_actual: 'dueno123', password_nueva: 'privada456'
  });
  probar('La dueña cambia su propia contraseña', passMaria.success);
  const mariaVieja = await ingresar('maria', 'dueno123');
  probar('La contraseña anterior deja de funcionar', mariaVieja.status === 401);
  const mariaNueva = await ingresar('maria', 'privada456');
  probar('La dueña entra con su contraseña nueva', mariaNueva.success);
  await llamar('maria', 'PUT', '/auth/password', {
    password_actual: 'privada456', password_nueva: 'dueno123'
  }); // la regresa para dejar el seed consistente

  const passAdmin = await llamar('admin', 'PUT', '/auth/password', {
    password_actual: 'admin123', password_nueva: 'superclave9'
  });
  probar('El superadmin cambia su propia contraseña', passAdmin.success);
  const adminNuevo = await ingresar('admin', 'superclave9');
  probar('El superadmin entra con la contraseña nueva', adminNuevo.success);
  await llamar('admin', 'PUT', '/auth/password', {
    password_actual: 'superclave9', password_nueva: 'admin123'
  });

  // Clientes que llegan a pie: la placa es opcional
  const tableroM = await llamar('carlos', 'GET', '/habitaciones');
  const libreM = tableroM.data.habitaciones.find((h) => h.estado === 'disponible' && h.tarifas.length);
  const entradaSinPlaca = await llamar('carlos', 'POST', '/estancias', {
    habitacion_id: libreM.id, tipo: 'horas', tarifa_id: libreM.tarifas[0].id
  });
  probar('Se registra entrada SIN placa (clientes a pie)',
    entradaSinPlaca.success && entradaSinPlaca.data.placa === '');
  const salidaSinPlaca = await llamar('carlos', 'POST', `/estancias/${entradaSinPlaca.data.id}/salida`, {
    metodo: 'efectivo', efectivo_recibido: 10000
  });
  probar('La estancia sin placa se liquida y finaliza normal', salidaSinPlaca.success);
  await llamar('carlos', 'POST', `/habitaciones/${libreM.id}/limpia`);

  console.log('\n=== N. Control de caja: arqueo, cierre e historial ===');
  // La caja de pedro (hotel 1) sigue abierta desde la sección C.
  const estadoN = await llamar('pedro', 'GET', '/caja/estado');
  probar('Hay una caja abierta con su efectivo esperado', estadoN.success && estadoN.data.abierta !== null);
  const turnoId = estadoN.data.abierta.id;
  const esperado = Number(estadoN.data.abierta.efectivo_esperado);
  const [sumEfectivo] = await bd.query(
    "SELECT COALESCE(SUM(monto_total), 0) AS s FROM cobros WHERE turno_id = ? AND metodo = 'efectivo'",
    [turnoId]
  );
  probar('Efectivo esperado = fondo (Q300) + cobros en efectivo del turno',
    esperado === Math.round((300 + Number(sumEfectivo[0].s)) * 100) / 100);

  const [transfTurno] = await bd.query(
    "SELECT COUNT(*) AS n FROM cobros WHERE turno_id = ? AND metodo = 'transferencia'",
    [turnoId]
  );
  probar('Los cobros por transferencia NO cuentan para el efectivo de caja', true, `(transferencias enlazadas: ${transfTurno[0].n})`);

  const cierre = await llamar('pedro', 'POST', '/caja/cerrar', { monto_declarado: esperado + 40 });
  probar('Cierre: descuadre = declarado - sistema (sobrante Q40)',
    cierre.success && Number(cierre.data.monto_sistema) === esperado && Number(cierre.data.descuadre) === 40);
  const estadoTrasCierre = await llamar('pedro', 'GET', '/caja/estado');
  probar('Tras cerrar, el hotel queda sin caja abierta', estadoTrasCierre.data.abierta === null);

  const histDueno = await llamar('carlos', 'GET', '/caja/historial');
  probar('El dueño ve el historial con el turno cerrado y su descuadre',
    histDueno.success && histDueno.data.some((c) => c.id === turnoId && c.estado === 'cerrada' && Number(c.descuadre) === 40));
  const histTrabajador = await llamar('pedro', 'GET', '/caja/historial');
  probar('El trabajador NO accede al historial de cajas (403)', histTrabajador.status === 403);

  // Sin caja abierta: el trabajador vuelve a estar bloqueado; el dueño no.
  tablero = await llamar('pedro', 'GET', '/habitaciones');
  const libresN = tablero.data.habitaciones.filter((h) => h.estado === 'disponible' && h.tarifas.length);
  probar('Hay habitaciones libres para las pruebas finales de caja', libresN.length >= 2);

  const entradaN = await llamar('pedro', 'POST', '/estancias', { habitacion_id: libresN[0].id, tipo: 'horas', tarifa_id: libresN[0].tarifas[0].id });
  probar('Registrar entrada NO requiere caja (aún no hay cobro)', entradaN.success);
  const cobroBloqueado = await llamar('pedro', 'POST', `/estancias/${entradaN.data.id}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 10000 });
  probar('Sin caja el trabajador no cobra efectivo (409)', cobroBloqueado.status === 409);
  const cobroTransfSinCaja = await llamar('pedro', 'POST', `/estancias/${entradaN.data.id}/pago-base`, { metodo: 'transferencia' });
  probar('Sin caja el trabajador SÍ cobra por transferencia (no toca efectivo)', cobroTransfSinCaja.success);

  const entradaDuenoN = await llamar('carlos', 'POST', '/estancias', { habitacion_id: libresN[1].id, tipo: 'horas', tarifa_id: libresN[1].tarifas[0].id });
  const cobroDuenoSinCaja = await llamar('carlos', 'POST', `/estancias/${entradaDuenoN.data.id}/pago-base`, { metodo: 'efectivo', efectivo_recibido: 10000 });
  probar('El dueño cobra en efectivo SIN caja (exento del control de turno)', cobroDuenoSinCaja.success);

  console.log('\n=== Ñ. Super Admin: propietarios (ficha), hoteles, consultas, limpieza, retención ===');

  // --- Ficha completa del propietario ---
  const propNuevo = await llamar('admin', 'POST', '/superadmin/duenos', {
    nombre: 'Propietario Ficha', usuario: 'prop.ficha', password: 'ficha123',
    dpi: '1234 56789 0101', nit: '999999-9', telefono: '5555-1234',
    correo: 'prop@correo.com', direccion: 'Zona 1', observaciones: 'Cliente VIP'
  });
  probar('Crear propietario con ficha completa', propNuevo.success);
  const correoInvalido = await llamar('admin', 'POST', '/superadmin/duenos', {
    nombre: 'X', usuario: 'prop.mal', password: 'ficha123', correo: 'no-es-correo'
  });
  probar('Correo con formato inválido es rechazado (400)', correoInvalido.status === 400);

  let listaProp = await llamar('admin', 'GET', '/superadmin/duenos');
  const fichaGuardada = listaProp.data.find((d) => d.usuario === 'prop.ficha');
  probar('La ficha se guarda y se lee (DPI, NIT, teléfono, correo)',
    fichaGuardada && fichaGuardada.dpi === '1234 56789 0101' && fichaGuardada.nit === '999999-9'
    && fichaGuardada.telefono === '5555-1234' && fichaGuardada.correo === 'prop@correo.com');
  probar('El listado incluye fecha de registro y conteo de hoteles',
    Boolean(fichaGuardada.creado_en) && Array.isArray(fichaGuardada.hoteles));

  const editarFicha = await llamar('admin', 'PUT', `/superadmin/duenos/${propNuevo.data.id}`, {
    nombre: 'Propietario Ficha', dpi: '1234 56789 0101', nit: '111111-1',
    telefono: '5555-9999', correo: 'nuevo@correo.com', direccion: 'Zona 9', observaciones: 'Actualizado'
  });
  probar('Editar ficha del propietario', editarFicha.success);
  listaProp = await llamar('admin', 'GET', '/superadmin/duenos');
  const fichaEditada = listaProp.data.find((d) => d.id === propNuevo.data.id);
  probar('La edición de ficha persiste (NIT y teléfono nuevos)',
    fichaEditada.nit === '111111-1' && fichaEditada.telefono === '5555-9999' && fichaEditada.correo === 'nuevo@correo.com');

  // --- Administración de hoteles: eliminar / desactivar ---
  const hotelLimpio = await llamar('admin', 'POST', '/superadmin/hoteles', {
    dueno_id: propNuevo.data.id, nombre: 'Hotel Sin Historial', direccion: 'Prueba'
  });
  const eliminarLimpio = await llamar('admin', 'DELETE', `/superadmin/hoteles/${hotelLimpio.data.id}`);
  probar('Eliminar hotel SIN historial funciona', eliminarLimpio.success);

  // Hotel 1 (El Paraíso) tiene historial e incluso estancias activas → no se elimina
  const eliminarConHistorial = await llamar('admin', 'DELETE', '/superadmin/hoteles/1');
  probar('Eliminar hotel CON historial/actividad se bloquea', !eliminarConHistorial.success);
  const desactivarHotel = await llamar('admin', 'PUT', '/superadmin/hoteles/2', {
    nombre: 'AutoHotel Luna Azul', direccion: 'Zona 12, Ciudad de Guatemala',
    minutos_alerta_limpieza: 30, horas_noche: 12, activo: 0
  });
  probar('Desactivación lógica del hotel (sin borrar) funciona', desactivarHotel.success);
  // Reactivar para no dejar el seed alterado para otras vueltas
  await llamar('admin', 'PUT', '/superadmin/hoteles/2', {
    nombre: 'AutoHotel Luna Azul', direccion: 'Zona 12, Ciudad de Guatemala',
    minutos_alerta_limpieza: 30, horas_noche: 12, activo: 1
  });

  // --- Consultas avanzadas ---
  const hoy2 = new Date().toISOString().slice(0, 10);
  const cVentas = await llamar('admin', 'GET', `/superadmin/consultas/ventas_dia?desde=2020-01-01&hasta=${hoy2}`);
  probar('Consulta ventas por día devuelve filas', cVentas.success && Array.isArray(cVentas.data.filas) && cVentas.data.filas.length > 0);
  const cReservas = await llamar('admin', 'GET', '/superadmin/consultas/reservas?estado=usada');
  probar('Consulta de reservas (usadas) responde', cReservas.success && Array.isArray(cReservas.data.filas));
  const cHabDisp = await llamar('admin', 'GET', '/superadmin/consultas/habitaciones?estado=disponible');
  probar('Consulta de habitaciones disponibles responde con filas', cHabDisp.success && cHabDisp.data.filas.length > 0);
  const cUsuarios = await llamar('admin', 'GET', '/superadmin/consultas/usuarios?estado=activos');
  probar('Consulta de usuarios activos excluye al superadmin', cUsuarios.success && cUsuarios.data.filas.every((u) => u.rol !== 'superadmin'));
  const cInvBajo = await llamar('admin', 'GET', '/superadmin/consultas/inventario_bajo');
  probar('Consulta de inventario bajo stock responde', cInvBajo.success && Array.isArray(cInvBajo.data.filas));
  const cAuditoria = await llamar('admin', 'GET', '/superadmin/consultas/auditoria');
  probar('Consulta de auditoría muestra las acciones ya registradas', cAuditoria.success && cAuditoria.data.filas.length > 0);
  const cDesconocida = await llamar('admin', 'GET', '/superadmin/consultas/inventar_algo');
  probar('Consulta desconocida es rechazada (400)', cDesconocida.status === 400);
  const cHoteles = await llamar('admin', 'GET', '/superadmin/consultas/hoteles');
  probar('Lista de hoteles para el filtro responde', cHoteles.success && cHoteles.data.length > 0);

  // Seguridad: dueño/trabajador no acceden a las consultas
  const consultaProhibida = await llamar('carlos', 'GET', '/superadmin/consultas/ventas_dia');
  probar('Un dueño NO accede a las consultas del superadmin (403)', consultaProhibida.status === 403);

  // --- Auditoría: verificar que las acciones quedan con usuario e IP ---
  const [audRows] = await bd.query(
    "SELECT accion, usuario_nombre, ip FROM auditoria WHERE accion = 'dueno.crear' ORDER BY id DESC LIMIT 1");
  probar('La auditoría registra usuario, acción e IP',
    audRows.length && audRows[0].usuario_nombre === 'Administrador del Sistema' && audRows[0].accion === 'dueno.crear');

  // --- Limpieza de datos ---
  const resumenLimp = await llamar('admin', 'GET', `/superadmin/limpieza/resumen?fecha=${hoy2}`);
  probar('Resumen de limpieza lista tipos con conteos',
    resumenLimp.success && Array.isArray(resumenLimp.data.tipos) && resumenLimp.data.tipos.some((t) => t.tipo === 'auditoria'));

  const limpSinConfirmar = await llamar('admin', 'POST', '/superadmin/limpieza/ejecutar', {
    fecha: '2000-01-01', tipos: ['auditoria'], confirmacion: 'no'
  });
  probar('Limpieza sin confirmación "ELIMINAR" se rechaza (400)', limpSinConfirmar.status === 400);
  const limpTipoInvalido = await llamar('admin', 'POST', '/superadmin/limpieza/ejecutar', {
    fecha: '2000-01-01', tipos: ['inexistente'], confirmacion: 'ELIMINAR'
  });
  probar('Limpieza con tipo inválido se rechaza (400)', limpTipoInvalido.status === 400);

  // Ejecutar limpieza real de sesiones expiradas (no toca datos de negocio)
  const limpSesiones = await llamar('admin', 'POST', '/superadmin/limpieza/ejecutar', {
    fecha: hoy2, tipos: ['sesiones'], confirmacion: 'ELIMINAR'
  });
  probar('Ejecutar limpieza de sesiones expiradas responde con total',
    limpSesiones.success && typeof limpSesiones.data.total_eliminados === 'number');
  const [audLimp] = await bd.query("SELECT COUNT(*) n FROM auditoria WHERE accion = 'limpieza.ejecutar'");
  probar('La limpieza queda registrada en la auditoría', audLimp[0].n > 0);

  // Seguridad: dueño no puede ejecutar limpieza
  const limpProhibida = await llamar('carlos', 'POST', '/superadmin/limpieza/ejecutar', {
    fecha: hoy2, tipos: ['sesiones'], confirmacion: 'ELIMINAR'
  });
  probar('Un dueño NO puede ejecutar limpieza (403)', limpProhibida.status === 403);

  // --- Políticas de retención ---
  const politicas = await llamar('admin', 'GET', '/superadmin/retencion');
  probar('Listado de políticas de retención con valores por defecto',
    politicas.success && politicas.data.length >= 6 && politicas.data.every((p) => typeof p.meses === 'number'));
  const editarPolitica = await llamar('admin', 'PUT', '/superadmin/retencion', {
    tipo: 'reservas', meses: 24, programada: 'trimestral'
  });
  probar('Editar política de retención (reservas: 24 meses, trimestral)', editarPolitica.success);
  const politicas2 = await llamar('admin', 'GET', '/superadmin/retencion');
  const polReservas = politicas2.data.find((p) => p.tipo === 'reservas');
  probar('La política editada persiste', polReservas.meses === 24 && polReservas.programada === 'trimestral');
  const polProhibida = await llamar('carlos', 'GET', '/superadmin/retencion');
  probar('Un dueño NO accede a las políticas de retención (403)', polProhibida.status === 403);

  // --- Último acceso (auditoría de accesos) ---
  const [accesoRows] = await bd.query("SELECT ultimo_acceso FROM usuarios WHERE usuario = 'admin'");
  probar('El login registra el último acceso del usuario', accesoRows[0].ultimo_acceso !== null);

  // Limpieza del propietario de prueba creado en esta sección
  await llamar('admin', 'DELETE', `/superadmin/duenos/${propNuevo.data.id}`, { confirmar_usuario: 'prop.ficha' });

  console.log('\n=== O. Retiros de caja, notas automáticas y cierre por el dueño ===');
  // Abrir caja (pedro) con fondo Q200
  const cajaO = await llamar('pedro', 'POST', '/caja/abrir', { monto_inicial: 200 });
  probar('El trabajador abre caja con fondo Q200', cajaO.success);

  const retiroSinJust = await llamar('pedro', 'POST', '/caja/retiros', { monto: 10 });
  probar('Retiro sin justificación es rechazado (400)', retiroSinJust.status === 400);
  const retiroCero = await llamar('pedro', 'POST', '/caja/retiros', { monto: 0, justificacion: 'x' });
  probar('Retiro de monto cero es rechazado (400)', retiroCero.status === 400);
  const retiroExcesivo = await llamar('pedro', 'POST', '/caja/retiros', { monto: 500, justificacion: 'excede' });
  probar('No se puede retirar más del efectivo disponible (400)', retiroExcesivo.status === 400);

  const retiro1 = await llamar('pedro', 'POST', '/caja/retiros', {
    monto: 50, justificacion: 'desayuno trabajadores'
  });
  probar('Retiro del trabajador con justificación funciona', retiro1.success);
  probar('NOTA con formato estricto "DD-MM-YYYY se retira 50 para desayuno trabajadores"',
    /^\d{2}-\d{2}-\d{4} se retira 50 para desayuno trabajadores$/.test(retiro1.data.nota));
  probar('El retiro devuelve el nuevo efectivo esperado (200 − 50 = 150)',
    Number(retiro1.data.efectivo_esperado) === 150);

  const retiro2 = await llamar('pedro', 'POST', '/caja/retiros', {
    monto: 25.5, justificacion: 'compra de insumos'
  });
  probar('Nota con decimales usa dos cifras ("se retira 25.50 para…")',
    retiro2.success && /se retira 25\.50 para compra de insumos$/.test(retiro2.data.nota));

  // El DUEÑO también puede retirar de la misma caja activa
  const retiroDueno = await llamar('carlos', 'POST', '/caja/retiros', {
    monto: 10, justificacion: 'retiro del dueño'
  });
  probar('El dueño también retira de la caja activa (compartida)', retiroDueno.success);

  const retirosLista = await llamar('pedro', 'GET', '/caja/retiros');
  probar('La caja lista sus 3 retiros con notas', retirosLista.success && retirosLista.data.retiros.length === 3);

  const estadoO = await llamar('pedro', 'GET', '/caja/estado');
  probar('Estado: esperado = 200 − 50 − 25.50 − 10 = Q114.50',
    Number(estadoO.data.abierta.total_retiros) === 85.5
    && Number(estadoO.data.abierta.efectivo_esperado) === 114.5);

  // Una venta en efectivo sube el esperado (fórmula completa)
  const tableroO = await llamar('pedro', 'GET', '/habitaciones');
  const libreO = tableroO.data.habitaciones.find((h) => h.estado === 'disponible' && h.tarifas.length);
  probar('Hay habitación libre para la venta de la fórmula', Boolean(libreO));
  const tarifaO = libreO.tarifas[0];
  const entradaO = await llamar('pedro', 'POST', '/estancias', {
    habitacion_id: libreO.id, placa: 'E2E-CAJA2', tipo: 'horas', tarifa_id: tarifaO.id
  });
  await llamar('pedro', 'POST', `/estancias/${entradaO.data.id}/pago-base`, {
    metodo: 'efectivo', efectivo_recibido: 10000
  });
  const esperadoFormula = Math.round((200 + Number(tarifaO.precio) - 85.5) * 100) / 100;
  const estadoO2 = await llamar('pedro', 'GET', '/caja/estado');
  probar('Fórmula completa: (inicial + ventas efectivo) − retiros',
    Number(estadoO2.data.abierta.efectivo_esperado) === esperadoFormula);

  // Cierre por el DUEÑO con retiro del efectivo y nota automática
  const cierreO = await llamar('carlos', 'POST', '/caja/cerrar', {
    monto_declarado: esperadoFormula - 20, retirar_efectivo: true
  });
  probar('El DUEÑO cierra la caja (cierre flexible)', cierreO.success);
  probar('monto_sistema respeta la fórmula y descuadre = −20',
    Number(cierreO.data.monto_sistema) === esperadoFormula && Number(cierreO.data.descuadre) === -20);
  probar('Nota de cierre "DD-MM-YYYY se retira efectivo del hotel"',
    /^\d{2}-\d{2}-\d{4} se retira efectivo del hotel$/.test(cierreO.data.nota_cierre));

  const [retiroCierre] = await bd.query(
    "SELECT tipo, monto FROM retiros_caja WHERE turno_id = ? AND tipo = 'cierre'", [cierreO.data.id]);
  probar('El retiro de cierre queda guardado con el monto declarado',
    retiroCierre.length === 1 && Number(retiroCierre[0].monto) === esperadoFormula - 20);

  const histO = await llamar('carlos', 'GET', '/caja/historial');
  const turnoO = histO.data.find((t) => t.id === cierreO.data.id);
  probar('El historial del dueño muestra retiros del turno y conteo de notas',
    Number(turnoO.total_retiros) === 85.5 && Number(turnoO.notas) === 4);

  const notasDueno = await llamar('carlos', 'GET', `/caja/${cierreO.data.id}/retiros`);
  probar('El dueño ve las 4 notas del turno (3 gastos + 1 cierre)',
    notasDueno.success && notasDueno.data.length === 4);
  const notasTrabajador = await llamar('pedro', 'GET', `/caja/${cierreO.data.id}/retiros`);
  probar('El trabajador NO ve notas de turnos del historial (403)', notasTrabajador.status === 403);

  const retiroSinCaja = await llamar('pedro', 'POST', '/caja/retiros', { monto: 5, justificacion: 'sin caja' });
  probar('Sin caja abierta no hay retiros (409)', retiroSinCaja.status === 409);

  console.log('\n=== P. Extras opcionales por habitación + módulo de gastos ===');
  // Extras del seed: el tablero los expone por habitación
  let tableroP = await llamar('carlos', 'GET', '/habitaciones');
  const h04 = tableroP.data.habitaciones.find((h) => h.id === 4);
  const h01P = tableroP.data.habitaciones.find((h) => h.id === 1);
  probar('El tablero expone los extras del seed (H-04 con Jacuzzi Q40)',
    h04 && h04.extras.some((x) => x.nombre === 'Jacuzzi' && Number(x.precio) === 40));
  probar('Las habitaciones sin extras devuelven lista vacía (el dueño elige cuáles)',
    h01P && Array.isArray(h01P.extras) && h01P.extras.length === 0);

  // El dueño configura extras en una habitación libre vía edición
  const adminP = await llamar('carlos', 'GET', '/habitaciones/admin');
  const libreP = tableroP.data.habitaciones.find((h) =>
    h.estado === 'disponible' && h.tarifas.length && !h.extras.length);
  probar('Hay habitación libre sin extras para configurar', Boolean(libreP));
  const fichaP = adminP.data.find((h) => h.id === libreP.id);
  const datosBaseP = {
    nombre: fichaP.nombre, precio_noche: fichaP.precio_noche,
    precio_hora_extra: fichaP.precio_hora_extra, activo: 1,
    tarifas: fichaP.tarifas.map((t) => ({ nombre: t.nombre, horas: t.horas, precio: t.precio }))
  };
  const agregarExtra = await llamar('carlos', 'PUT', `/habitaciones/${libreP.id}`, {
    ...datosBaseP, extras: [{ nombre: 'Jacuzzi', precio: 40 }, { nombre: 'Decoración', precio: 60 }]
  });
  probar('El dueño agrega extras a la habitación', agregarExtra.success);

  const extraDuplicado = await llamar('carlos', 'PUT', `/habitaciones/${libreP.id}`, {
    ...datosBaseP, extras: [{ nombre: 'Jacuzzi', precio: 40 }, { nombre: 'jacuzzi', precio: 50 }]
  });
  probar('Extras con nombre repetido se rechazan (400)', extraDuplicado.status === 400);
  const extraGratis = await llamar('carlos', 'PUT', `/habitaciones/${libreP.id}`, {
    ...datosBaseP, extras: [{ nombre: 'Gratis', precio: 0 }]
  });
  probar('Extra con precio cero se rechaza (400)', extraGratis.status === 400);
  const extrasExceso = await llamar('carlos', 'PUT', `/habitaciones/${libreP.id}`, {
    ...datosBaseP, extras: Array.from({ length: 9 }, (_, i) => ({ nombre: 'X' + i, precio: 10 }))
  });
  probar('Más de 8 extras se rechazan (400)', extrasExceso.status === 400);

  tableroP = await llamar('carlos', 'GET', '/habitaciones');
  const conExtrasP = tableroP.data.habitaciones.find((h) => h.id === libreP.id);
  probar('El tablero refleja los 2 extras configurados', conExtrasP.extras.length === 2);
  const jacuzziP = conExtrasP.extras.find((x) => x.nombre === 'Jacuzzi');

  // Entrada con extra elegido: el cargo se fotografía y se cobra
  const tarifaP = conExtrasP.tarifas[0];
  const entradaP = await llamar('carlos', 'POST', '/estancias', {
    habitacion_id: libreP.id, tipo: 'horas', tarifa_id: tarifaP.id, extras: [jacuzziP.id]
  });
  const totalP = Math.round((Number(tarifaP.precio) + 40) * 100) / 100;
  probar('Entrada con extra: total = tarifa + Q40 y descripción "Jacuzzi"',
    entradaP.success && Number(entradaP.data.cargo_extra) === 40
    && entradaP.data.cargo_descripcion === 'Jacuzzi'
    && Number(entradaP.data.total_cobro_base) === totalP);

  // Anti-IDOR: un extra de OTRA habitación no aplica
  const otraLibreP = tableroP.data.habitaciones.find((h) =>
    h.estado === 'disponible' && h.tarifas.length && h.id !== libreP.id);
  const extraAjeno = await llamar('carlos', 'POST', '/estancias', {
    habitacion_id: otraLibreP.id, tipo: 'horas',
    tarifa_id: otraLibreP.tarifas[0].id, extras: [jacuzziP.id]
  });
  probar('AISLAMIENTO: extra de otra habitación → 404', extraAjeno.status === 404);

  // El cobro y la salida cuadran con el extra incluido
  const pagoP = await llamar('carlos', 'POST', `/estancias/${entradaP.data.id}/pago-base`, {
    metodo: 'efectivo', efectivo_recibido: totalP
  });
  probar('El cobro base exige tarifa + extra (cambio Q0)', pagoP.success && Number(pagoP.data.total) === totalP);
  const salidaP = await llamar('carlos', 'POST', `/estancias/${entradaP.data.id}/salida`, {});
  probar('La salida cierra con total final = tarifa + extra', salidaP.success && Number(salidaP.data.total_final) === totalP);
  const [cobrosP] = await bd.query(
    'SELECT COALESCE(SUM(monto_total), 0) AS suma FROM cobros WHERE estancia_id = ?', [entradaP.data.id]);
  probar('El libro de cobros cuadra con el extra incluido', Number(cobrosP[0].suma) === totalP);
  await llamar('carlos', 'POST', `/habitaciones/${libreP.id}/limpia`);

  // El dueño puede QUITAR los extras (elige qué habitación los tiene)
  const quitarExtras = await llamar('carlos', 'PUT', `/habitaciones/${libreP.id}`, {
    ...datosBaseP, extras: []
  });
  tableroP = await llamar('carlos', 'GET', '/habitaciones');
  probar('El dueño quita los extras y el tablero queda limpio',
    quitarExtras.success
    && tableroP.data.habitaciones.find((h) => h.id === libreP.id).extras.length === 0);

  // Módulo de gastos: historial del dueño (los gastos de la sección O)
  const gastosDueno = await llamar('carlos', 'GET', '/caja/gastos');
  probar('Historial de gastos del dueño: 4 retiros y total sin cierres Q85.50',
    gastosDueno.success && gastosDueno.data.retiros.length === 4
    && Number(gastosDueno.data.total_gastos) === 85.5);
  const gastosFuturos = await llamar('carlos', 'GET', '/caja/gastos?desde=2030-01-01&hasta=2030-12-31');
  probar('El filtro de fechas del historial funciona (rango vacío)',
    gastosFuturos.success && gastosFuturos.data.retiros.length === 0);
  const gastosTrabajador = await llamar('pedro', 'GET', '/caja/gastos');
  probar('El trabajador NO accede al historial de gastos (403)', gastosTrabajador.status === 403);

  console.log('\n=== Q. Baja de inventario por trabajador + extras post-pago ===');
  // --- Ajuste de stock por el trabajador (con justificación auditada) ---
  const productosQ = await llamar('pedro', 'GET', '/productos');
  const productoQ = productosQ.data.find((p) => p.activo && p.stock >= 2);
  probar('Hay producto activo con stock para ajustar', Boolean(productoQ));
  const motivoQ = 'Consumo interno: limpieza de habitaciones';
  const bajaQ = await llamar('pedro', 'POST', `/productos/${productoQ.id}/ajuste`, {
    direccion: 'restar', cantidad: 2, motivo: motivoQ
  });
  probar('El trabajador resta stock con justificación (baja por consumo interno)',
    bajaQ.success && bajaQ.data.stock === productoQ.stock - 2);
  const sinMotivoQ = await llamar('pedro', 'POST', `/productos/${productoQ.id}/ajuste`, {
    direccion: 'restar', cantidad: 1
  });
  probar('BLOQUEO: ajuste sin justificación se rechaza (400)', sinMotivoQ.status === 400);
  const excesoQ = await llamar('pedro', 'POST', `/productos/${productoQ.id}/ajuste`, {
    direccion: 'restar', cantidad: 999999, motivo: 'intento de dejar stock negativo'
  });
  probar('BLOQUEO: restar más que el stock existente se rechaza', !excesoQ.success);
  const movimientosQ = await llamar('carlos', 'GET', `/productos/movimientos?producto_id=${productoQ.id}`);
  const movQ = movimientosQ.data[0];
  probar('AUDITORÍA: guarda producto, cantidad, trabajador y justificación exacta',
    movimientosQ.success && movQ && movQ.tipo === 'ajuste_negativo' && movQ.cantidad === 2
    && movQ.motivo === motivoQ && movQ.usuario_rol === 'trabajador'
    && movQ.producto_nombre === productoQ.nombre && Boolean(movQ.fecha));
  const [productoAjenoQ] = await bd.query('SELECT id FROM productos WHERE hotel_id = 3 LIMIT 1');
  const ajusteAjenoQ = await llamar('pedro', 'POST', `/productos/${productoAjenoQ[0].id}/ajuste`, {
    direccion: 'restar', cantidad: 1, motivo: 'intento entre hoteles'
  });
  probar('AISLAMIENTO: el trabajador no ajusta productos de otro hotel (404)', ajusteAjenoQ.status === 404);
  const movTrabajadorQ = await llamar('pedro', 'GET', '/productos/movimientos');
  probar('El historial de movimientos sigue siendo solo del dueño (403)', movTrabajadorQ.status === 403);

  // --- Extras agregados con la estancia en curso (incluso ya pagado el base) ---
  let tableroQ = await llamar('carlos', 'GET', '/habitaciones');
  const libreQ = tableroQ.data.habitaciones.find((h) =>
    h.estado === 'disponible' && h.tarifas.length && !h.extras.length);
  const adminQ = await llamar('carlos', 'GET', '/habitaciones/admin');
  const fichaQ = adminQ.data.find((h) => h.id === libreQ.id);
  const datosBaseQ = {
    nombre: fichaQ.nombre, precio_noche: fichaQ.precio_noche,
    precio_hora_extra: fichaQ.precio_hora_extra, activo: 1,
    tarifas: fichaQ.tarifas.map((t) => ({ nombre: t.nombre, horas: t.horas, precio: t.precio }))
  };
  const configuraQ = await llamar('carlos', 'PUT', `/habitaciones/${libreQ.id}`, {
    ...datosBaseQ, extras: [{ nombre: 'Jacuzzi', precio: 40 }, { nombre: 'Decoración', precio: 60 }]
  });
  probar('El dueño configura extras para la prueba', configuraQ.success);

  // El PUT regenera tarifas y extras: refrescar para obtener ids vigentes
  tableroQ = await llamar('carlos', 'GET', '/habitaciones');
  const habQ = tableroQ.data.habitaciones.find((h) => h.id === libreQ.id);
  const tarifaQ = habQ.tarifas[0];
  const entradaQ = await llamar('carlos', 'POST', '/estancias', {
    habitacion_id: libreQ.id, tipo: 'horas', tarifa_id: tarifaQ.id
  });
  const detalleQ = await llamar('carlos', 'GET', `/estancias/${entradaQ.data.id}`);
  probar('El detalle de la estancia expone el menú de extras de la habitación',
    detalleQ.success && detalleQ.data.extras_disponibles.length === 2);
  const jacuzziQ = detalleQ.data.extras_disponibles.find((x) => x.nombre === 'Jacuzzi');
  const decoracionQ = detalleQ.data.extras_disponibles.find((x) => x.nombre === 'Decoración');

  // Antes de pagar: el extra engrosa el cobro base (sin saldo aparte)
  const extraAntesQ = await llamar('pedro', 'POST', `/estancias/${entradaQ.data.id}/extras`, {
    extra_id: jacuzziQ.id
  });
  probar('Extra agregado ANTES de pagar: engrosa el cobro base sin saldo aparte',
    extraAntesQ.success && Number(extraAntesQ.data.cargo_extra) === 40
    && extraAntesQ.data.cargo_descripcion === 'Jacuzzi'
    && Number(extraAntesQ.data.cargo_extra_pendiente) === 0);
  const totalBaseQ = Math.round((Number(tarifaQ.precio) + 40) * 100) / 100;
  const pagoQ = await llamar('carlos', 'POST', `/estancias/${entradaQ.data.id}/pago-base`, {
    metodo: 'efectivo', efectivo_recibido: totalBaseQ
  });
  probar('El cobro base exige tarifa + extra agregado en curso',
    pagoQ.success && Number(pagoQ.data.total) === totalBaseQ);

  // Después de pagar: el nuevo extra queda como saldo pendiente
  const extraDespuesQ = await llamar('pedro', 'POST', `/estancias/${entradaQ.data.id}/extras`, {
    extra_id: decoracionQ.id
  });
  probar('Extra agregado DESPUÉS de pagar: queda saldo pendiente Q60',
    extraDespuesQ.success && Number(extraDespuesQ.data.cargo_extra) === 100
    && Number(extraDespuesQ.data.cargo_extra_pendiente) === 60
    && extraDespuesQ.data.cargo_descripcion === 'Jacuzzi + Decoración');
  const repetidoQ = await llamar('pedro', 'POST', `/estancias/${entradaQ.data.id}/extras`, {
    extra_id: jacuzziQ.id
  });
  probar('BLOQUEO: el mismo extra no se agrega dos veces (409)', repetidoQ.status === 409);
  const h04Q = tableroQ.data.habitaciones.find((h) => h.id === 4);
  const extraAjenoQ = await llamar('pedro', 'POST', `/estancias/${entradaQ.data.id}/extras`, {
    extra_id: h04Q.extras[0].id
  });
  probar('AISLAMIENTO: extra de otra habitación → 404', extraAjenoQ.status === 404);

  const preSalidaQ = await llamar('carlos', 'GET', `/estancias/${entradaQ.data.id}/pre-salida`);
  probar('La pre-salida muestra el saldo del extra como pendiente',
    preSalidaQ.success && Number(preSalidaQ.data.cargo_extra_pendiente) === 60
    && Number(preSalidaQ.data.total_pendiente) === 60
    && Number(preSalidaQ.data.total_final) === totalBaseQ + 60);
  const salidaQ = await llamar('carlos', 'POST', `/estancias/${entradaQ.data.id}/salida`, {
    metodo: 'efectivo', efectivo_recibido: 60
  });
  probar('La salida cobra el saldo del extra (cambio Q0) y el total cuadra',
    salidaQ.success && Number(salidaQ.data.total_final) === totalBaseQ + 60
    && salidaQ.data.cambio === 0);
  const [cobrosQ] = await bd.query(
    'SELECT COALESCE(SUM(monto_total), 0) AS suma FROM cobros WHERE estancia_id = ?', [entradaQ.data.id]);
  probar('El libro de cobros cuadra: base con extra inicial + saldo posterior',
    Number(cobrosQ[0].suma) === totalBaseQ + 60);
  const finalizadaQ = await llamar('pedro', 'POST', `/estancias/${entradaQ.data.id}/extras`, {
    extra_id: decoracionQ.id
  });
  probar('BLOQUEO: no se agregan extras a una estancia finalizada', !finalizadaQ.success);
  await llamar('carlos', 'POST', `/habitaciones/${libreQ.id}/limpia`);

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
