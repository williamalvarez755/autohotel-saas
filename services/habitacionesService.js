// ============================================================
// Servicio de habitaciones: tablero en tiempo real, CRUD del
// dueño (incluye el motor de tarifas por habitación), cambios
// manuales de estado y flujo de limpieza.
//
// Motor de tarifas: cada habitación define su menú de paquetes
// precio/tiempo (ej. "3 horas" Q100, "6 horas" Q160) más el
// precio de noche y el precio por hora extra. Las tarifas se
// guardan en la tabla `tarifas` y se administran junto con la
// habitación (estrategia de reemplazo total en transacción; las
// estancias históricas no se ven afectadas porque guardan una
// foto de la tarifa pactada).
// ============================================================

const { pool, conTransaccion } = require('../db/pool');
const { ESTADOS_HABITACION, ESTADOS_RESERVA, ESTADOS_ESTANCIA } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, aEpoch, minutosTranscurridos } = require('../utils/fechas');

/** Tarifas de todas las habitaciones del hotel agrupadas por habitación. */
async function tarifasPorHabitacion(hotelId) {
  const [filas] = await pool.query(
    `SELECT id, habitacion_id, nombre, horas, precio
       FROM tarifas
      WHERE hotel_id = ?
      ORDER BY habitacion_id, horas, precio`,
    [hotelId]
  );
  const mapa = new Map();
  for (const t of filas) {
    if (!mapa.has(t.habitacion_id)) mapa.set(t.habitacion_id, []);
    mapa.get(t.habitacion_id).push({ id: t.id, nombre: t.nombre, horas: t.horas, precio: t.precio });
  }
  return mapa;
}

/**
 * Tablero de habitaciones del hotel con la información viva:
 * estancia activa (si está ocupada), reserva pendiente (si está
 * reservada), minutos en limpieza y el menú de tarifas de cada
 * habitación. Incluye épocas en ms para que el frontend muestre
 * contadores en vivo sin depender del reloj del navegador.
 */
async function tablero(hotelId) {
  const [filas] = await pool.query(
    `SELECT h.id, h.nombre, h.estado, h.precio_noche, h.precio_hora_extra, h.limpieza_desde,
            e.id AS estancia_id, e.placa, e.tipo, e.horas_contratadas,
            e.tarifa_nombre, e.hora_entrada, e.hora_salida_prevista, e.pagado_base,
            e.total_base, e.total_pedidos,
            r.id AS reserva_id, r.fecha_hora AS reserva_fecha_hora,
            r.placa AS reserva_placa, r.nota AS reserva_nota,
            r.cargo_extra AS reserva_cargo_extra, r.cargo_descripcion AS reserva_cargo_descripcion
       FROM habitaciones h
       LEFT JOIN estancias e
         ON e.habitacion_id = h.id AND e.estado = 'activa'
       LEFT JOIN reservas r
         ON r.id = (SELECT r2.id
                      FROM reservas r2
                     WHERE r2.habitacion_id = h.id AND r2.estado = 'pendiente'
                     ORDER BY r2.fecha_hora
                     LIMIT 1)
      WHERE h.hotel_id = ? AND h.activo = 1
      ORDER BY h.nombre`,
    [hotelId]
  );

  const tarifas = await tarifasPorHabitacion(hotelId);
  const ahoraEpoch = Date.now();
  const habitaciones = filas.map((f) => ({
    ...f,
    tarifas: tarifas.get(f.id) || [],
    entrada_epoch: aEpoch(f.hora_entrada),
    salida_prevista_epoch: aEpoch(f.hora_salida_prevista),
    reserva_epoch: aEpoch(f.reserva_fecha_hora),
    minutos_limpieza: f.estado === ESTADOS_HABITACION.LIMPIEZA && f.limpieza_desde
      ? Math.max(0, minutosTranscurridos(f.limpieza_desde))
      : null
  }));

  return { habitaciones, ahora_epoch: ahoraEpoch, ahora: ahoraGT() };
}

/** Lista completa para administración del dueño (incluye inactivas). */
async function listarAdmin(hotelId) {
  const [filas] = await pool.query(
    `SELECT id, nombre, estado, precio_noche, precio_hora_extra, activo
       FROM habitaciones
      WHERE hotel_id = ?
      ORDER BY activo DESC, nombre`,
    [hotelId]
  );
  const tarifas = await tarifasPorHabitacion(hotelId);
  return filas.map((f) => ({ ...f, tarifas: tarifas.get(f.id) || [] }));
}

/** Reemplaza el menú de tarifas de una habitación (dentro de transacción). */
async function reemplazarTarifas(cx, hotelId, habitacionId, tarifas) {
  await cx.query('DELETE FROM tarifas WHERE habitacion_id = ? AND hotel_id = ?', [habitacionId, hotelId]);
  if (!tarifas.length) return;
  const valores = tarifas.map((t) => [hotelId, habitacionId, t.nombre, t.horas, t.precio]);
  await cx.query(
    'INSERT INTO tarifas (hotel_id, habitacion_id, nombre, horas, precio) VALUES ?',
    [valores]
  );
}

/** Crea una habitación con su menú de tarifas (solo dueño). */
async function crear(hotelId, datos) {
  return conTransaccion(async (cx) => {
    const [existe] = await cx.query(
      'SELECT id FROM habitaciones WHERE hotel_id = ? AND nombre = ? LIMIT 1',
      [hotelId, datos.nombre]
    );
    if (existe.length) {
      throw new ErrorNegocio('Ya existe una habitación con ese nombre en este hotel');
    }
    const [resultado] = await cx.query(
      `INSERT INTO habitaciones (hotel_id, nombre, estado, precio_noche, precio_hora_extra, activo)
       VALUES (?, ?, 'disponible', ?, ?, 1)`,
      [hotelId, datos.nombre, datos.precio_noche, datos.precio_hora_extra]
    );
    await reemplazarTarifas(cx, hotelId, resultado.insertId, datos.tarifas);
    return { id: resultado.insertId };
  });
}

/** Edita nombre, tarifas, precios o estado activo de una habitación (solo dueño). */
async function editar(hotelId, habitacionId, datos) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id, estado FROM habitaciones WHERE id = ? AND hotel_id = ? LIMIT 1 FOR UPDATE',
      [habitacionId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Habitación no encontrada', 404);

    const [duplicado] = await cx.query(
      'SELECT id FROM habitaciones WHERE hotel_id = ? AND nombre = ? AND id <> ? LIMIT 1',
      [hotelId, datos.nombre, habitacionId]
    );
    if (duplicado.length) {
      throw new ErrorNegocio('Ya existe otra habitación con ese nombre en este hotel');
    }

    if (datos.activo === 0) {
      if (filas[0].estado === ESTADOS_HABITACION.OCUPADA) {
        throw new ErrorNegocio('No se puede desactivar una habitación ocupada');
      }
      const [reservas] = await cx.query(
        `SELECT id FROM reservas WHERE habitacion_id = ? AND estado = 'pendiente' LIMIT 1`,
        [habitacionId]
      );
      if (reservas.length) {
        throw new ErrorNegocio('No se puede desactivar una habitación con reservas pendientes');
      }
    }

    await cx.query(
      `UPDATE habitaciones
          SET nombre = ?, precio_noche = ?, precio_hora_extra = ?, activo = ?
        WHERE id = ? AND hotel_id = ?`,
      [datos.nombre, datos.precio_noche, datos.precio_hora_extra, datos.activo, habitacionId, hotelId]
    );
    // Las estancias en curso o históricas no se ven afectadas: cada
    // estancia guarda su propia foto de tarifa y precio de hora extra.
    await reemplazarTarifas(cx, hotelId, habitacionId, datos.tarifas);
    return { id: habitacionId };
  });
}

/**
 * Cambio manual de estado para casos especiales.
 * Solo se permite mover entre: disponible <-> limpieza, y
 * reservada -> disponible (cancelando la reserva pendiente).
 * Nunca se puede poner "ocupada" a mano (solo con una entrada) ni
 * sacar de "ocupada" (solo finalizando la estancia).
 */
async function cambiarEstadoManual(hotelId, habitacionId, nuevoEstado) {
  const permitidos = [ESTADOS_HABITACION.DISPONIBLE, ESTADOS_HABITACION.LIMPIEZA];
  if (!permitidos.includes(nuevoEstado)) {
    throw new ErrorNegocio('Solo se puede cambiar manualmente a "disponible" o "limpieza"');
  }

  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id, estado FROM habitaciones WHERE id = ? AND hotel_id = ? AND activo = 1 LIMIT 1 FOR UPDATE',
      [habitacionId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Habitación no encontrada', 404);
    const habitacion = filas[0];

    const [estancias] = await cx.query(
      `SELECT id FROM estancias WHERE habitacion_id = ? AND estado = ? LIMIT 1`,
      [habitacionId, ESTADOS_ESTANCIA.ACTIVA]
    );
    if (estancias.length) {
      throw new ErrorNegocio('La habitación tiene una estancia activa: debe finalizarla primero');
    }

    // Si estaba reservada y se libera, la reserva pendiente se cancela.
    if (habitacion.estado === ESTADOS_HABITACION.RESERVADA) {
      await cx.query(
        `UPDATE reservas SET estado = ? WHERE habitacion_id = ? AND estado = ?`,
        [ESTADOS_RESERVA.CANCELADA, habitacionId, ESTADOS_RESERVA.PENDIENTE]
      );
    }

    const limpiezaDesde = nuevoEstado === ESTADOS_HABITACION.LIMPIEZA ? ahoraGT() : null;
    await cx.query(
      'UPDATE habitaciones SET estado = ?, limpieza_desde = ? WHERE id = ? AND hotel_id = ?',
      [nuevoEstado, limpiezaDesde, habitacionId, hotelId]
    );
    return { id: habitacionId, estado: nuevoEstado };
  });
}

/** Habitaciones actualmente en limpieza con su tiempo transcurrido. */
async function listaLimpieza(hotelId, minutosAlerta) {
  const [filas] = await pool.query(
    `SELECT id, nombre, limpieza_desde
       FROM habitaciones
      WHERE hotel_id = ? AND activo = 1 AND estado = 'limpieza'
      ORDER BY limpieza_desde`,
    [hotelId]
  );
  return filas.map((f) => {
    const minutos = f.limpieza_desde ? Math.max(0, minutosTranscurridos(f.limpieza_desde)) : 0;
    return { ...f, minutos, alerta: minutos >= minutosAlerta };
  });
}

/** LIMPIEZA -> DISPONIBLE. */
async function marcarLimpia(hotelId, habitacionId) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      'SELECT id, estado FROM habitaciones WHERE id = ? AND hotel_id = ? AND activo = 1 LIMIT 1 FOR UPDATE',
      [habitacionId, hotelId]
    );
    if (!filas.length) throw new ErrorNegocio('Habitación no encontrada', 404);
    if (filas[0].estado !== ESTADOS_HABITACION.LIMPIEZA) {
      throw new ErrorNegocio('La habitación no está en limpieza');
    }
    await cx.query(
      `UPDATE habitaciones SET estado = 'disponible', limpieza_desde = NULL WHERE id = ? AND hotel_id = ?`,
      [habitacionId, hotelId]
    );
    return { id: habitacionId, estado: ESTADOS_HABITACION.DISPONIBLE };
  });
}

module.exports = { tablero, listarAdmin, crear, editar, cambiarEstadoManual, listaLimpieza, marcarLimpia };
