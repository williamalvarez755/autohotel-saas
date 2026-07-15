// ============================================================
// Constantes del dominio. Único lugar donde se definen roles,
// estados y mensajes reutilizados en todo el sistema.
// ============================================================

const ROLES = {
  SUPERADMIN: 'superadmin',
  DUENO: 'dueno',
  TRABAJADOR: 'trabajador'
};

const ESTADOS_HABITACION = {
  DISPONIBLE: 'disponible',
  OCUPADA: 'ocupada',
  LIMPIEZA: 'limpieza',
  RESERVADA: 'reservada'
};

const TIPOS_ESTANCIA = {
  HORAS: 'horas',
  NOCHE: 'noche'
};

const ESTADOS_ESTANCIA = {
  ACTIVA: 'activa',
  FINALIZADA: 'finalizada'
};

const ESTADOS_RESERVA = {
  PENDIENTE: 'pendiente',
  USADA: 'usada',
  CANCELADA: 'cancelada'
};

const ESTADOS_SUSCRIPCION = {
  ACTIVA: 'activa',
  SUSPENDIDA: 'suspendida'
};

const TIPOS_MOVIMIENTO = {
  ENTRADA: 'entrada',
  SALIDA: 'salida',
  AJUSTE_POSITIVO: 'ajuste_positivo',
  AJUSTE_NEGATIVO: 'ajuste_negativo'
};

const TIPOS_COBRO = {
  BASE: 'base',
  SALIDA: 'salida'
};

const ESTADOS_CAJA = {
  ABIERTA: 'abierta',
  CERRADA: 'cerrada'
};

const METODOS_PAGO = ['efectivo', 'transferencia'];

const LIMITES = {
  MAX_HORAS_CONTRATADAS: 24,
  MAX_CANTIDAD_PEDIDO: 999,
  MAX_MONTO: 1000000,
  // Motor de tarifas: paquetes precio/tiempo por habitación
  MAX_TARIFAS_POR_HABITACION: 8,
  // Costo de calcular hashes bcrypt (compartido por todos los servicios)
  RONDAS_BCRYPT: 10,
  // Rate limit del login: intentos por ventana de tiempo
  LOGIN_MAX_INTENTOS: 10,
  LOGIN_VENTANA_MS: 5 * 60 * 1000
};

const MENSAJES = {
  SUSPENDIDO: 'Servicio suspendido, comuníquese con el proveedor',
  CREDENCIALES: 'Usuario o contraseña incorrectos',
  USUARIO_DESACTIVADO: 'Usuario desactivado, comuníquese con el administrador',
  NO_AUTENTICADO: 'Debe iniciar sesión',
  NO_AUTORIZADO: 'No tiene permisos para realizar esta acción',
  NO_ENCONTRADO: 'Recurso no encontrado',
  ERROR_INTERNO: 'Error interno del servidor'
};

module.exports = {
  ROLES,
  ESTADOS_HABITACION,
  TIPOS_ESTANCIA,
  ESTADOS_ESTANCIA,
  ESTADOS_RESERVA,
  ESTADOS_SUSCRIPCION,
  TIPOS_MOVIMIENTO,
  TIPOS_COBRO,
  ESTADOS_CAJA,
  METODOS_PAGO,
  LIMITES,
  MENSAJES
};
