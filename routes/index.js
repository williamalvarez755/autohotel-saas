// ============================================================
// Enrutador principal de la API. Aquí se definen las guardas de
// cada grupo de rutas:
//   - requiereSesion: usuario autenticado, activo y con
//     suscripción vigente (se revalida en cada petición).
//   - requiereRol: autorización por rol.
//   - resolverHotel: aislamiento multi-tenant (req.hotelId).
// ============================================================

const express = require('express');
const { requiereSesion, requiereRol, limitadorLogin } = require('../middleware/auth');
const { resolverHotel } = require('../middleware/tenant');
const { envolverAsync: e } = require('../middleware/errores');
const { ROLES } = require('../config/constantes');

const authController = require('../controllers/authController');
const habitacionesController = require('../controllers/habitacionesController');
const estanciasController = require('../controllers/estanciasController');
const pedidosController = require('../controllers/pedidosController');
const productosController = require('../controllers/productosController');
const reservasController = require('../controllers/reservasController');
const cajaController = require('../controllers/cajaController');
const reportesController = require('../controllers/reportesController');
const alertasController = require('../controllers/alertasController');
const usuariosController = require('../controllers/usuariosController');
const superadminController = require('../controllers/superadminController');
const consultasController = require('../controllers/consultasController');

const router = express.Router();

// Guardas compuestas reutilizables
const operacion = [requiereSesion, requiereRol(ROLES.DUENO, ROLES.TRABAJADOR), resolverHotel];
const soloDueno = [requiereSesion, requiereRol(ROLES.DUENO), resolverHotel];
const soloDuenoSinHotel = [requiereSesion, requiereRol(ROLES.DUENO)];
const soloSuperadmin = [requiereSesion, requiereRol(ROLES.SUPERADMIN)];

// ---------------- Autenticación ----------------
router.post('/auth/login', limitadorLogin, e(authController.login));
router.post('/auth/logout', e(authController.logout));
router.get('/auth/sesion', requiereSesion, e(authController.sesion));
router.post('/auth/hotel-activo', requiereSesion, e(authController.cambiarHotel));
// Cambio de contraseña propia: solo superadmin y dueños. Los
// trabajadores no tienen autoservicio (su dueño la administra).
router.put('/auth/password', requiereSesion, requiereRol(ROLES.SUPERADMIN, ROLES.DUENO), e(authController.cambiarPassword));

// ---------------- Habitaciones ----------------
router.get('/habitaciones', operacion, e(habitacionesController.tablero));
router.get('/habitaciones/admin', soloDueno, e(habitacionesController.listarAdmin));
router.post('/habitaciones', soloDueno, e(habitacionesController.crear));
router.put('/habitaciones/:id', soloDueno, e(habitacionesController.editar));
router.put('/habitaciones/:id/estado', operacion, e(habitacionesController.cambiarEstado));

// ---------------- Limpieza ----------------
router.get('/limpieza', operacion, e(habitacionesController.listaLimpieza));
router.post('/habitaciones/:id/limpia', operacion, e(habitacionesController.marcarLimpia));

// ---------------- Estancias ----------------
router.post('/estancias', operacion, e(estanciasController.registrarEntrada));
router.get('/estancias/activas', operacion, e(estanciasController.listarActivas));
router.get('/estancias/:id', operacion, e(estanciasController.detalle));
router.post('/estancias/:id/pago-base', operacion, e(estanciasController.pagarBase));
// Agregar un extra del menú de la habitación con la estancia en
// curso (incluso ya pagado el base: queda saldo pendiente a la salida)
router.post('/estancias/:id/extras', operacion, e(estanciasController.agregarExtra));
router.get('/estancias/:id/pre-salida', operacion, e(estanciasController.preSalida));
router.post('/estancias/:id/salida', operacion, e(estanciasController.finalizar));

// ---------------- Pedidos ----------------
router.get('/estancias/:id/pedidos', operacion, e(pedidosController.listar));
router.post('/estancias/:id/pedidos', operacion, e(pedidosController.crear));

// ---------------- Inventario ----------------
router.get('/productos', operacion, e(productosController.listar));
router.post('/productos', operacion, e(productosController.crear));
router.put('/productos/:id', soloDueno, e(productosController.editar));
router.post('/productos/:id/entrada', operacion, e(productosController.registrarEntrada));
// Ajuste de stock (baja por consumo interno, daño, conteo físico):
// dueño Y trabajador, siempre con motivo obligatorio; cada ajuste
// queda auditado en movimientos_inventario con usuario y fecha.
router.post('/productos/:id/ajuste', operacion, e(productosController.ajustarStock));
router.get('/productos/movimientos', soloDueno, e(productosController.movimientos));

// ---------------- Reservas ----------------
router.get('/reservas', operacion, e(reservasController.listar));
router.post('/reservas', operacion, e(reservasController.crear));
router.post('/reservas/:id/cancelar', operacion, e(reservasController.cancelar));

// ---------------- Control de caja ----------------
// estado/abrir/cerrar los usan dueño y trabajador; el historial de
// auditoría es solo del dueño.
router.get('/caja/estado', operacion, e(cajaController.estado));
router.post('/caja/abrir', operacion, e(cajaController.abrir));
router.post('/caja/cerrar', operacion, e(cajaController.cerrar));
// Retiros/gastos: dueño Y trabajador pueden sacar efectivo con
// justificación; cada retiro guarda su nota autogenerada.
router.post('/caja/retiros', operacion, e(cajaController.retirar));
router.get('/caja/retiros', operacion, e(cajaController.retiros));
router.get('/caja/historial', soloDueno, e(cajaController.historial));
router.get('/caja/gastos', soloDueno, e(cajaController.gastos));
router.get('/caja/:id/retiros', soloDueno, e(cajaController.notasDeTurno));

// ---------------- Alertas ----------------
router.get('/alertas', operacion, e(alertasController.obtener));

// ---------------- Dashboard y reportes (solo dueño) ----------------
router.get('/dashboard', soloDueno, e(reportesController.dashboard));
router.get('/reportes/ingresos-dia', soloDueno, e(reportesController.ingresosPorDia));
router.get('/reportes/ingresos-habitacion', soloDueno, e(reportesController.ingresosPorHabitacion));
router.get('/reportes/productos-vendidos', soloDueno, e(reportesController.productosMasVendidos));
router.get('/reportes/estancias', soloDueno, e(reportesController.estancias));

// ---------------- Usuarios del dueño ----------------
router.get('/usuarios', soloDuenoSinHotel, e(usuariosController.listar));
router.post('/usuarios', soloDuenoSinHotel, e(usuariosController.crear));
router.put('/usuarios/:id', soloDuenoSinHotel, e(usuariosController.editar));
router.put('/usuarios/:id/activo', soloDuenoSinHotel, e(usuariosController.cambiarActivo));

// ---------------- Superadmin ----------------
router.get('/superadmin/duenos', soloSuperadmin, e(superadminController.listarDuenos));
router.post('/superadmin/duenos', soloSuperadmin, e(superadminController.crearDueno));
router.put('/superadmin/duenos/:id', soloSuperadmin, e(superadminController.editarDueno));
router.delete('/superadmin/duenos/:id', soloSuperadmin, e(superadminController.eliminarDueno));
router.post('/superadmin/duenos/:id/suspender', soloSuperadmin, e(superadminController.suspender));
router.post('/superadmin/duenos/:id/reactivar', soloSuperadmin, e(superadminController.reactivar));
router.post('/superadmin/duenos/:id/pagos', soloSuperadmin, e(superadminController.registrarPago));
router.get('/superadmin/duenos/:id/pagos', soloSuperadmin, e(superadminController.pagosDeDueno));
router.post('/superadmin/hoteles', soloSuperadmin, e(superadminController.crearHotel));
router.put('/superadmin/hoteles/:id', soloSuperadmin, e(superadminController.editarHotel));
router.delete('/superadmin/hoteles/:id', soloSuperadmin, e(superadminController.eliminarHotel));

// Consultas avanzadas (solo superadmin; catálogo parametrizado)
router.get('/superadmin/consultas/hoteles', soloSuperadmin, e(consultasController.hotelesFiltro));
router.get('/superadmin/consultas/:tipo', soloSuperadmin, e(consultasController.consultar));

// Limpieza de datos históricos + políticas de retención
router.get('/superadmin/limpieza/resumen', soloSuperadmin, e(consultasController.limpiezaResumen));
router.get('/superadmin/limpieza/respaldo', soloSuperadmin, e(consultasController.limpiezaRespaldo));
router.post('/superadmin/limpieza/ejecutar', soloSuperadmin, e(consultasController.limpiezaEjecutar));
router.get('/superadmin/retencion', soloSuperadmin, e(consultasController.politicas));
router.put('/superadmin/retencion', soloSuperadmin, e(consultasController.actualizarPolitica));

module.exports = router;
