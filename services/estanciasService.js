// ============================================================
// Servicio de estancias: registro de entrada, cobro base
// adelantado, consulta de estancias activas, cálculo de salida
// y finalización. Todos los flujos críticos van en transacción
// y todos los montos se calculan aquí, nunca en el frontend.
//
// Motor de tarifas: la entrada "por horas" exige elegir una
// tarifa de la habitación (paquete precio/tiempo definido por el
// dueño). La estancia guarda una FOTO de lo pactado (tarifa_id,
// tarifa_nombre, horas, precio y precio_hora_extra), de modo que
// cambios de precios posteriores jamás alteran cobros en curso.
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const {
  ESTADOS_HABITACION,
  ESTADOS_ESTANCIA,
  ESTADOS_RESERVA,
  TIPOS_ESTANCIA,
  TIPOS_COBRO
} = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, sumarHoras, aEpoch, horasExtra } = require('../utils/fechas');
const { redondear, sumar, multiplicar } = require('../utils/dinero');

/**
 * Registra la entrada de un cliente.
 * - Bloquea la habitación (FOR UPDATE) para evitar dobles entradas.
 * - Si viene reserva_id, convierte la reserva pendiente en entrada.
 * - tipo 'horas': la tarifa elegida dicta precio y duración; se
 *   valida que pertenezca a ESTA habitación de ESTE hotel (anti-IDOR).
 * - tipo 'noche': precio_noche de la habitación y horas_noche del hotel.
 * - Calcula hora de salida prevista y total base SIEMPRE en backend.
 * - Deja la habitación OCUPADA y la estancia lista para el cobro base.
 */
async function registrarEntrada(hotel, usuarioId, datos) {
  return conTransaccion(async (cx) => {
    const [habitaciones] = await cx.query(
      'SELECT * FROM habitaciones WHERE id = ? AND hotel_id = ? AND activo = 1 LIMIT 1 FOR UPDATE',
      [datos.habitacion_id, hotel.id]
    );
    if (!habitaciones.length) throw new ErrorNegocio('Habitación no encontrada', 404);
    const habitacion = habitaciones[0];

    let reserva = null;
    if (datos.reserva_id) {
      const [reservas] = await cx.query(
        `SELECT * FROM reservas
          WHERE id = ? AND hotel_id = ? AND habitacion_id = ? AND estado = 'pendiente'
          LIMIT 1 FOR UPDATE`,
        [datos.reserva_id, hotel.id, habitacion.id]
      );
      if (!reservas.length) {
        throw new ErrorNegocio('La reserva no existe, no es de esta habitación o ya no está pendiente', 404);
      }
      reserva = reservas[0];
    }

    if (habitacion.estado === ESTADOS_HABITACION.RESERVADA) {
      if (!reserva) {
        throw new ErrorNegocio('La habitación está reservada: use la reserva o cancélela primero');
      }
    } else if (habitacion.estado !== ESTADOS_HABITACION.DISPONIBLE) {
      throw new ErrorNegocio(`La habitación no está disponible (estado actual: ${habitacion.estado})`);
    }

    const horaEntrada = ahoraGT();
    let tarifaId = null;
    let tarifaNombre;
    let horasContratadas;
    let totalBase;

    if (datos.tipo === TIPOS_ESTANCIA.HORAS) {
      // La tarifa debe ser de esta habitación y este hotel: un ID de
      // otra habitación u otro hotel devuelve 404 aunque exista.
      const [tarifas] = await cx.query(
        'SELECT * FROM tarifas WHERE id = ? AND habitacion_id = ? AND hotel_id = ? LIMIT 1',
        [datos.tarifa_id, habitacion.id, hotel.id]
      );
      if (!tarifas.length) {
        throw new ErrorNegocio('La tarifa seleccionada no existe para esta habitación', 404);
      }
      const tarifa = tarifas[0];
      tarifaId = tarifa.id;
      tarifaNombre = tarifa.nombre;
      horasContratadas = tarifa.horas;
      totalBase = redondear(tarifa.precio);
    } else {
      tarifaNombre = 'Noche completa';
      horasContratadas = hotel.horas_noche;
      totalBase = redondear(habitacion.precio_noche);
    }

    const horaSalidaPrevista = sumarHoras(horaEntrada, horasContratadas);
    const precioHoraExtra = redondear(habitacion.precio_hora_extra);

    const [resultado] = await cx.query(
      `INSERT INTO estancias
         (hotel_id, habitacion_id, placa, tipo, tarifa_id, tarifa_nombre,
          horas_contratadas, precio_hora_extra, hora_entrada, hora_salida_prevista,
          total_base, total_habitacion, total_final, estado, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'activa', ?)`,
      [
        hotel.id, habitacion.id, datos.placa, datos.tipo, tarifaId, tarifaNombre,
        horasContratadas, precioHoraExtra, horaEntrada, horaSalidaPrevista,
        totalBase, totalBase, totalBase, usuarioId
      ]
    );

    await cx.query(
      `UPDATE habitaciones SET estado = 'ocupada', limpieza_desde = NULL WHERE id = ?`,
      [habitacion.id]
    );

    if (reserva) {
      await cx.query('UPDATE reservas SET estado = ? WHERE id = ?', [ESTADOS_RESERVA.USADA, reserva.id]);
    }

    return {
      id: resultado.insertId,
      habitacion_id: habitacion.id,
      habitacion_nombre: habitacion.nombre,
      placa: datos.placa,
      tipo: datos.tipo,
      tarifa_nombre: tarifaNombre,
      horas_contratadas: horasContratadas,
      precio_hora_extra: precioHoraExtra,
      hora_entrada: horaEntrada,
      hora_salida_prevista: horaSalidaPrevista,
      total_base: totalBase,
      pagado_base: 0
    };
  });
}

/**
 * Confirma el cobro base adelantado de una estancia.
 * El total lo dicta la BD (total_base); si es efectivo se calcula
 * el cambio validando que lo recibido alcance.
 */
async function pagarBase(hotelId, usuarioId, estanciaId, metodo, efectivoRecibido) {
  return conTransaccion(async (cx) => {
    const [estancias] = await cx.query(
      `SELECT * FROM estancias WHERE id = ? AND hotel_id = ? AND estado = 'activa' LIMIT 1 FOR UPDATE`,
      [estanciaId, hotelId]
    );
    if (!estancias.length) throw new ErrorNegocio('Estancia no encontrada o ya finalizada', 404);
    const estancia = estancias[0];
    if (estancia.pagado_base) throw new ErrorNegocio('El cobro base de esta estancia ya fue pagado');

    const total = redondear(estancia.total_base);
    let cambio = null;
    if (metodo === 'efectivo') {
      if (efectivoRecibido < total) {
        throw new ErrorNegocio(`El efectivo recibido (Q ${efectivoRecibido.toFixed(2)}) es menor al total (Q ${total.toFixed(2)})`);
      }
      cambio = redondear(efectivoRecibido - total);
    }

    await cx.query(
      'UPDATE estancias SET pagado_base = 1, metodo_pago = ? WHERE id = ?',
      [metodo, estanciaId]
    );
    await cx.query(
      `INSERT INTO cobros (hotel_id, estancia_id, habitacion_id, tipo, monto_habitacion, monto_pedidos, monto_total, metodo, fecha, usuario_id)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [hotelId, estanciaId, estancia.habitacion_id, TIPOS_COBRO.BASE, total, total, metodo, ahoraGT(), usuarioId]
    );

    return { estancia_id: estanciaId, total, metodo, cambio };
  });
}

/** Estancias activas del hotel (para pantallas de pedidos y salida). */
async function listarActivas(hotelId) {
  const [filas] = await pool.query(
    `SELECT e.id, e.placa, e.tipo, e.tarifa_nombre, e.horas_contratadas,
            e.hora_entrada, e.hora_salida_prevista, e.pagado_base, e.total_base,
            e.total_pedidos, e.precio_hora_extra,
            h.nombre AS habitacion_nombre, h.id AS habitacion_id
       FROM estancias e
       JOIN habitaciones h ON h.id = e.habitacion_id
      WHERE e.hotel_id = ? AND e.estado = 'activa'
      ORDER BY e.hora_entrada`,
    [hotelId]
  );
  const ahoraEpoch = Date.now();
  return {
    estancias: filas.map((f) => ({
      ...f,
      entrada_epoch: aEpoch(f.hora_entrada),
      salida_prevista_epoch: aEpoch(f.hora_salida_prevista),
      excedida: ahoraEpoch > aEpoch(f.hora_salida_prevista)
    })),
    ahora_epoch: ahoraEpoch
  };
}

/** Carga una estancia del hotel con datos de su habitación. */
async function obtenerConHabitacion(cx, hotelId, estanciaId, bloquear = false) {
  const [filas] = await cx.query(
    `SELECT e.*, h.nombre AS habitacion_nombre, h.precio_noche
       FROM estancias e
       JOIN habitaciones h ON h.id = e.habitacion_id
      WHERE e.id = ? AND e.hotel_id = ?
      LIMIT 1 ${bloquear ? 'FOR UPDATE' : ''}`,
    [estanciaId, hotelId]
  );
  if (!filas.length) throw new ErrorNegocio('Estancia no encontrada', 404);
  return filas[0];
}

/**
 * Cálculo puro del desglose de salida de una estancia activa.
 * Las horas extra se cobran al precio_hora_extra FOTOGRAFIADO en
 * la estancia al registrar la entrada (no al precio actual de la
 * habitación): lo pactado con el cliente no cambia retroactivamente.
 */
function calcularDesglose(estancia, epochAhora) {
  const extras = horasExtra(estancia.hora_salida_prevista, epochAhora);
  const totalExtra = multiplicar(estancia.precio_hora_extra, extras);
  const totalBase = redondear(estancia.total_base);
  const totalPedidos = redondear(estancia.total_pedidos);
  const totalHabitacion = sumar(totalBase, totalExtra);
  const totalFinal = sumar(totalHabitacion, totalPedidos);
  const pendienteBase = estancia.pagado_base ? 0 : totalBase;
  const totalPendiente = sumar(pendienteBase, totalExtra, totalPedidos);
  return {
    horas_extra: extras,
    total_base: totalBase,
    total_extra: totalExtra,
    total_habitacion: totalHabitacion,
    total_pedidos: totalPedidos,
    total_final: totalFinal,
    pendiente_base: pendienteBase,
    total_pendiente: totalPendiente
  };
}

/** Detalle de una estancia con sus pedidos. */
async function detalle(hotelId, estanciaId) {
  const estancia = await obtenerConHabitacion(pool, hotelId, estanciaId);
  const [pedidos] = await pool.query(
    `SELECT p.id, p.cantidad, p.precio_unitario, p.subtotal, p.fecha, pr.nombre AS producto_nombre
       FROM pedidos p
       JOIN productos pr ON pr.id = p.producto_id
      WHERE p.estancia_id = ? AND p.hotel_id = ?
      ORDER BY p.fecha DESC`,
    [estanciaId, hotelId]
  );
  return {
    estancia: {
      ...estancia,
      entrada_epoch: aEpoch(estancia.hora_entrada),
      salida_prevista_epoch: aEpoch(estancia.hora_salida_prevista)
    },
    pedidos
  };
}

/** Vista previa del cobro de salida (no modifica nada). */
async function preSalida(hotelId, estanciaId) {
  const estancia = await obtenerConHabitacion(pool, hotelId, estanciaId);
  if (estancia.estado !== ESTADOS_ESTANCIA.ACTIVA) {
    throw new ErrorNegocio('La estancia ya fue finalizada');
  }
  const desglose = calcularDesglose(estancia, Date.now());
  return {
    estancia_id: estancia.id,
    habitacion_nombre: estancia.habitacion_nombre,
    placa: estancia.placa,
    tipo: estancia.tipo,
    tarifa_nombre: estancia.tarifa_nombre,
    horas_contratadas: estancia.horas_contratadas,
    hora_entrada: estancia.hora_entrada,
    hora_salida_prevista: estancia.hora_salida_prevista,
    pagado_base: estancia.pagado_base,
    precio_hora_extra: estancia.precio_hora_extra,
    ...desglose
  };
}

/**
 * Finaliza la estancia: recalcula extras al momento real de la
 * salida, cobra lo pendiente (base no pagada + horas extra +
 * pedidos), registra el cobro y pasa la habitación a LIMPIEZA.
 */
async function finalizar(hotelId, usuarioId, estanciaId, metodo, efectivoRecibido) {
  return conTransaccion(async (cx) => {
    const estancia = await obtenerConHabitacion(cx, hotelId, estanciaId, true);
    if (estancia.estado !== ESTADOS_ESTANCIA.ACTIVA) {
      throw new ErrorNegocio('La estancia ya fue finalizada');
    }

    const epochAhora = Date.now();
    const horaSalidaReal = ahoraGT();
    const d = calcularDesglose(estancia, epochAhora);

    let cambio = null;
    if (d.total_pendiente > 0) {
      if (!metodo) {
        throw new ErrorNegocio('Debe indicar el método de pago para liquidar lo pendiente');
      }
      if (metodo === 'efectivo') {
        if (efectivoRecibido < d.total_pendiente) {
          throw new ErrorNegocio(
            `El efectivo recibido (Q ${efectivoRecibido.toFixed(2)}) es menor al pendiente (Q ${d.total_pendiente.toFixed(2)})`
          );
        }
        cambio = redondear(efectivoRecibido - d.total_pendiente);
      }
    }

    await cx.query(
      `UPDATE estancias
          SET hora_salida_real = ?, horas_extra = ?, total_extra = ?,
              total_habitacion = ?, total_final = ?, pagado_base = 1,
              metodo_pago_salida = ?, estado = 'finalizada'
        WHERE id = ?`,
      [
        horaSalidaReal, d.horas_extra, d.total_extra,
        d.total_habitacion, d.total_final,
        d.total_pendiente > 0 ? metodo : null,
        estanciaId
      ]
    );

    await cx.query(
      `UPDATE habitaciones SET estado = 'limpieza', limpieza_desde = ? WHERE id = ? AND hotel_id = ?`,
      [horaSalidaReal, estancia.habitacion_id, hotelId]
    );

    if (d.total_pendiente > 0) {
      await cx.query(
        `INSERT INTO cobros (hotel_id, estancia_id, habitacion_id, tipo, monto_habitacion, monto_pedidos, monto_total, metodo, fecha, usuario_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          hotelId, estanciaId, estancia.habitacion_id, TIPOS_COBRO.SALIDA,
          sumar(d.pendiente_base, d.total_extra), d.total_pedidos, d.total_pendiente,
          metodo, horaSalidaReal, usuarioId
        ]
      );
    }

    return {
      estancia_id: estanciaId,
      habitacion_nombre: estancia.habitacion_nombre,
      hora_entrada: estancia.hora_entrada,
      hora_salida_real: horaSalidaReal,
      precio_hora_extra: estancia.precio_hora_extra,
      ...d,
      metodo: d.total_pendiente > 0 ? metodo : null,
      cambio
    };
  });
}

module.exports = { registrarEntrada, pagarBase, listarActivas, detalle, preSalida, finalizar };
