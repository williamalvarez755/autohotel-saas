// ============================================================
// Servicio del superadmin (proveedor del software): gestión de
// dueños, hoteles, suscripciones y pagos de mensualidad.
// El estado mostrado de cada suscripción se calcula así:
//   suspendida -> suspensión manual
//   vencida    -> fecha_vencimiento < hoy
//   por_vencer -> vence en <= N días (config DIAS_POR_VENCER)
//   activa     -> el resto
// ============================================================

const bcrypt = require('bcrypt');
const { pool, conTransaccion } = require('../db/pool');
const config = require('../config/config');
const { LIMITES } = require('../config/constantes');
const { ErrorNegocio } = require('../middleware/errores');
const { ahoraGT, hoyGT } = require('../utils/fechas');

const RONDAS_BCRYPT = LIMITES.RONDAS_BCRYPT;

/** Estado calculado de una suscripción. */
function estadoCalculado(estado, fechaVencimiento) {
  const hoy = hoyGT();
  const venc = String(fechaVencimiento).slice(0, 10);
  if (estado === 'suspendida') return 'suspendida';
  if (venc < hoy) return 'vencida';
  const dias = Math.round((Date.parse(venc) - Date.parse(hoy)) / 86400000);
  if (dias <= config.negocio.diasPorVencer) return 'por_vencer';
  return 'activa';
}

/** Suma un mes calendario a una fecha 'YYYY-MM-DD' (ajusta fin de mes). */
function sumarUnMes(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  const base = new Date(Date.UTC(a, m - 1 + 1, 1));
  const ultimoDia = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  const mes = String(base.getUTCMonth() + 1).padStart(2, '0');
  return `${base.getUTCFullYear()}-${mes}-${String(dia).padStart(2, '0')}`;
}

/** Lista de dueños con ficha, hoteles, suscripción y estado calculado. */
async function listarDuenos() {
  const [filas] = await pool.query(
    `SELECT u.id, u.nombre, u.usuario, u.activo,
            u.dpi, u.nit, u.telefono, u.correo, u.direccion, u.observaciones,
            u.creado_en, u.ultimo_acceso,
            s.estado AS suscripcion_estado, s.fecha_vencimiento,
            (SELECT COUNT(*) FROM hoteles h WHERE h.dueno_id = u.id AND h.activo = 1) AS hoteles_activos,
            (SELECT COUNT(*) FROM usuarios t WHERE t.dueno_id = u.id AND t.rol = 'trabajador' AND t.activo = 1) AS trabajadores_activos
       FROM usuarios u
       JOIN suscripciones s ON s.dueno_id = u.id
      WHERE u.rol = 'dueno'
      ORDER BY u.nombre`,
    []
  );
  const [hoteles] = await pool.query(
    `SELECT id, dueno_id, nombre, direccion, activo,
            minutos_alerta_limpieza, horas_noche
       FROM hoteles
      ORDER BY nombre`,
    []
  );
  return filas.map((d) => ({
    ...d,
    estado_calculado: estadoCalculado(d.suscripcion_estado, d.fecha_vencimiento),
    hoteles: hoteles.filter((h) => h.dueno_id === d.id)
  }));
}

/** Crea un dueño con su suscripción inicial. */
async function crearDueno(datos) {
  return conTransaccion(async (cx) => {
    const [existe] = await cx.query('SELECT id FROM usuarios WHERE usuario = ? LIMIT 1', [datos.usuario]);
    if (existe.length) throw new ErrorNegocio('El nombre de usuario ya está en uso');

    const hash = await bcrypt.hash(datos.password, RONDAS_BCRYPT);
    const ahora = ahoraGT();
    const [resultado] = await cx.query(
      `INSERT INTO usuarios
         (rol, nombre, usuario, password_hash, dueno_id, hotel_id, activo, creado_en,
          dpi, nit, telefono, correo, direccion, observaciones)
       VALUES ('dueno', ?, ?, ?, NULL, NULL, 1, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datos.nombre, datos.usuario, hash, ahora,
        datos.dpi, datos.nit, datos.telefono, datos.correo, datos.direccion, datos.observaciones
      ]
    );
    await cx.query(
      `INSERT INTO suscripciones (dueno_id, estado, fecha_vencimiento, actualizado_en)
       VALUES (?, 'activa', ?, ?)`,
      [resultado.insertId, datos.fecha_vencimiento, ahora]
    );
    return { id: resultado.insertId };
  });
}

/** Edita la ficha completa del dueño y, opcionalmente, su contraseña. */
async function editarDueno(duenoId, datos) {
  return conTransaccion(async (cx) => {
    const [filas] = await cx.query(
      `SELECT id FROM usuarios WHERE id = ? AND rol = 'dueno' LIMIT 1 FOR UPDATE`,
      [duenoId]
    );
    if (!filas.length) throw new ErrorNegocio('Dueño no encontrado', 404);

    await cx.query(
      `UPDATE usuarios
          SET nombre = ?, dpi = ?, nit = ?, telefono = ?, correo = ?,
              direccion = ?, observaciones = ?
        WHERE id = ?`,
      [
        datos.nombre, datos.dpi, datos.nit, datos.telefono, datos.correo,
        datos.direccion, datos.observaciones, duenoId
      ]
    );
    if (datos.password) {
      const hash = await bcrypt.hash(datos.password, RONDAS_BCRYPT);
      await cx.query('UPDATE usuarios SET password_hash = ? WHERE id = ?', [hash, duenoId]);
    }
    return { id: duenoId };
  });
}

/** Suspensión / reactivación manual de la cuenta de un dueño. */
async function cambiarSuspension(duenoId, suspender) {
  const [resultado] = await pool.query(
    `UPDATE suscripciones SET estado = ?, actualizado_en = ? WHERE dueno_id = ?`,
    [suspender ? 'suspendida' : 'activa', ahoraGT(), duenoId]
  );
  if (!resultado.affectedRows) throw new ErrorNegocio('Dueño no encontrado', 404);
  return { dueno_id: duenoId, estado: suspender ? 'suspendida' : 'activa' };
}

/**
 * Registra un pago de mensualidad:
 * - Guarda el pago (monto, mes correspondiente, nota).
 * - Extiende la fecha de vencimiento un mes calendario a partir
 *   de la fecha mayor entre hoy y el vencimiento actual.
 * - Reactiva la cuenta si estaba suspendida.
 */
async function registrarPago(adminId, duenoId, datos) {
  return conTransaccion(async (cx) => {
    const [suscripciones] = await cx.query(
      'SELECT id, fecha_vencimiento FROM suscripciones WHERE dueno_id = ? LIMIT 1 FOR UPDATE',
      [duenoId]
    );
    if (!suscripciones.length) throw new ErrorNegocio('Dueño no encontrado', 404);

    const hoy = hoyGT();
    const vencimientoActual = String(suscripciones[0].fecha_vencimiento).slice(0, 10);
    const base = vencimientoActual > hoy ? vencimientoActual : hoy;
    const nuevoVencimiento = sumarUnMes(base);
    const ahora = ahoraGT();

    await cx.query(
      `UPDATE suscripciones SET estado = 'activa', fecha_vencimiento = ?, actualizado_en = ? WHERE dueno_id = ?`,
      [nuevoVencimiento, ahora, duenoId]
    );
    const [resultado] = await cx.query(
      `INSERT INTO pagos_servicio (dueno_id, monto, fecha_pago, mes_correspondiente, nota, registrado_por)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [duenoId, datos.monto, ahora, datos.mes_correspondiente, datos.nota, adminId]
    );
    return { pago_id: resultado.insertId, nueva_fecha_vencimiento: nuevoVencimiento };
  });
}

/** Historial de pagos de un dueño. */
async function pagosDeDueno(duenoId) {
  const [duenos] = await pool.query(
    `SELECT id, nombre FROM usuarios WHERE id = ? AND rol = 'dueno' LIMIT 1`,
    [duenoId]
  );
  if (!duenos.length) throw new ErrorNegocio('Dueño no encontrado', 404);
  const [pagos] = await pool.query(
    `SELECT p.id, p.monto, p.fecha_pago, p.mes_correspondiente, p.nota,
            a.nombre AS registrado_por_nombre
       FROM pagos_servicio p
       JOIN usuarios a ON a.id = p.registrado_por
      WHERE p.dueno_id = ?
      ORDER BY p.fecha_pago DESC, p.id DESC`,
    [duenoId]
  );
  return { dueno: duenos[0], pagos };
}

/**
 * Elimina DEFINITIVAMENTE a un dueño y toda su jerarquía (hoteles,
 * trabajadores, habitaciones, tarifas, estancias, pedidos, cobros,
 * reservas, inventario, pagos y suscripción). Pensado para cuentas
 * que dejaron de pagar y quedaron como datos muertos.
 *
 * Salvaguardas:
 * - Exige la confirmación con el usuario EXACTO del dueño.
 * - Se niega si hay estancias activas (dinero sin liquidar).
 * - Todo ocurre en una transacción: o se borra todo o nada.
 */
async function eliminarDueno(duenoId, confirmarUsuario) {
  return conTransaccion(async (cx) => {
    const [duenos] = await cx.query(
      `SELECT id, nombre, usuario FROM usuarios WHERE id = ? AND rol = 'dueno' LIMIT 1 FOR UPDATE`,
      [duenoId]
    );
    if (!duenos.length) throw new ErrorNegocio('Dueño no encontrado', 404);
    const dueno = duenos[0];

    if (confirmarUsuario !== dueno.usuario) {
      throw new ErrorNegocio(
        `Confirmación incorrecta: escriba el usuario exacto del dueño ("${dueno.usuario}") para eliminarlo`
      );
    }

    const [hoteles] = await cx.query('SELECT id FROM hoteles WHERE dueno_id = ?', [duenoId]);
    const hotelIds = hoteles.map((h) => h.id);

    if (hotelIds.length) {
      const [activas] = await cx.query(
        `SELECT COUNT(*) AS total FROM estancias WHERE hotel_id IN (?) AND estado = 'activa'`,
        [hotelIds]
      );
      if (activas[0].total > 0) {
        throw new ErrorNegocio(
          `No se puede eliminar: tiene ${activas[0].total} estancia(s) activa(s) sin liquidar. Finalícelas primero.`
        );
      }

      // Purga en orden de dependencias (las llaves foráneas son RESTRICT)
      await cx.query('DELETE FROM cobros WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM pedidos WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM movimientos_inventario WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM reservas WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM estancias WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM tarifas WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM productos WHERE hotel_id IN (?)', [hotelIds]);
      await cx.query('DELETE FROM habitaciones WHERE hotel_id IN (?)', [hotelIds]);
    }

    await cx.query(`DELETE FROM usuarios WHERE dueno_id = ? AND rol = 'trabajador'`, [duenoId]);
    await cx.query('DELETE FROM pagos_servicio WHERE dueno_id = ?', [duenoId]);
    await cx.query('DELETE FROM suscripciones WHERE dueno_id = ?', [duenoId]);
    if (hotelIds.length) {
      await cx.query('DELETE FROM hoteles WHERE id IN (?)', [hotelIds]);
    }
    await cx.query('DELETE FROM usuarios WHERE id = ?', [duenoId]);

    return { id: duenoId, nombre: dueno.nombre, hoteles_eliminados: hotelIds.length };
  });
}

/** Crea un hotel y lo asigna a un dueño. */
async function crearHotel(datos) {
  const [duenos] = await pool.query(
    `SELECT id FROM usuarios WHERE id = ? AND rol = 'dueno' LIMIT 1`,
    [datos.dueno_id]
  );
  if (!duenos.length) throw new ErrorNegocio('El dueño indicado no existe', 404);

  const [resultado] = await pool.query(
    `INSERT INTO hoteles (dueno_id, nombre, direccion, minutos_alerta_limpieza, horas_noche, activo, creado_en)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    [datos.dueno_id, datos.nombre, datos.direccion, datos.minutos_alerta_limpieza, datos.horas_noche, ahoraGT()]
  );
  return { id: resultado.insertId };
}

/**
 * Edita un hotel (datos y configuración de reglas).
 * No se puede desactivar un hotel con estancias activas: quedaría
 * dinero sin liquidar y clientes "atrapados" sin poder darles salida.
 */
async function editarHotel(hotelId, datos) {
  return conTransaccion(async (cx) => {
    const [hoteles] = await cx.query(
      'SELECT id FROM hoteles WHERE id = ? LIMIT 1 FOR UPDATE',
      [hotelId]
    );
    if (!hoteles.length) throw new ErrorNegocio('Hotel no encontrado', 404);

    if (datos.activo === 0) {
      const [activas] = await cx.query(
        `SELECT COUNT(*) AS total FROM estancias WHERE hotel_id = ? AND estado = 'activa'`,
        [hotelId]
      );
      if (activas[0].total > 0) {
        throw new ErrorNegocio(
          `No se puede desactivar: el hotel tiene ${activas[0].total} estancia(s) activa(s) sin liquidar`
        );
      }
    }

    await cx.query(
      `UPDATE hoteles
          SET nombre = ?, direccion = ?, minutos_alerta_limpieza = ?, horas_noche = ?, activo = ?
        WHERE id = ?`,
      [datos.nombre, datos.direccion, datos.minutos_alerta_limpieza, datos.horas_noche, datos.activo, hotelId]
    );
    return { id: hotelId };
  });
}

/**
 * Elimina FÍSICAMENTE un hotel, solo si no tiene información
 * operativa relacionada. Reglas (pedidas por el negocio):
 * - Estancias activas / habitaciones ocupadas → bloqueado.
 * - Reservas pendientes → bloqueado.
 * - Pagos pendientes (estancias activas sin cobro base) → cubierto
 *   por el bloqueo de estancias activas.
 * - Trabajadores asignados → bloqueado (reasignar o desactivar).
 * - CUALQUIER historial (estancias, cobros, reservas, pedidos,
 *   movimientos, turnos de caja) → bloqueado: solo se ofrece la
 *   desactivación lógica (editarHotel con activo=0).
 * Si está limpio, borra su estructura (tarifas, productos,
 * habitaciones) y el hotel, en transacción. No toca a los demás
 * hoteles del dueño ni la ficha del propietario.
 */
async function eliminarHotel(hotelId) {
  return conTransaccion(async (cx) => {
    const [hoteles] = await cx.query(
      'SELECT id, nombre, dueno_id FROM hoteles WHERE id = ? LIMIT 1 FOR UPDATE',
      [hotelId]
    );
    if (!hoteles.length) throw new ErrorNegocio('Hotel no encontrado', 404);
    const hotel = hoteles[0];

    // Bloqueos duros (procesos críticos abiertos)
    const [[activas]] = await cx.query(
      `SELECT COUNT(*) AS n FROM estancias WHERE hotel_id = ? AND estado = 'activa'`, [hotelId]
    );
    if (activas.n > 0) {
      throw new ErrorNegocio(`No se puede eliminar: hay ${activas.n} habitación(es) ocupada(s) / estancia(s) activa(s). Finalícelas primero.`);
    }
    const [[pendientes]] = await cx.query(
      `SELECT COUNT(*) AS n FROM reservas WHERE hotel_id = ? AND estado = 'pendiente'`, [hotelId]
    );
    if (pendientes.n > 0) {
      throw new ErrorNegocio(`No se puede eliminar: hay ${pendientes.n} reserva(s) pendiente(s). Cancélelas o conviértalas primero.`);
    }
    const [[cajaAbierta]] = await cx.query(
      `SELECT COUNT(*) AS n FROM turnos_caja WHERE hotel_id = ? AND estado = 'abierta'`, [hotelId]
    );
    if (cajaAbierta.n > 0) {
      throw new ErrorNegocio('No se puede eliminar: hay una caja abierta en este hotel. Ciérrela primero.');
    }
    const [[trabajadores]] = await cx.query(
      `SELECT COUNT(*) AS n FROM usuarios WHERE hotel_id = ? AND rol = 'trabajador'`, [hotelId]
    );
    if (trabajadores.n > 0) {
      throw new ErrorNegocio(`No se puede eliminar: tiene ${trabajadores.n} trabajador(es) asignado(s). Reasígnelos o elimínelos primero.`);
    }

    // Historial: si existe, solo se permite la desactivación lógica
    const [[historial]] = await cx.query(
      `SELECT
         (SELECT COUNT(*) FROM estancias WHERE hotel_id = ?) +
         (SELECT COUNT(*) FROM cobros    WHERE hotel_id = ?) +
         (SELECT COUNT(*) FROM reservas  WHERE hotel_id = ?) +
         (SELECT COUNT(*) FROM pedidos   WHERE hotel_id = ?) +
         (SELECT COUNT(*) FROM movimientos_inventario WHERE hotel_id = ?) +
         (SELECT COUNT(*) FROM turnos_caja WHERE hotel_id = ?) AS n`,
      [hotelId, hotelId, hotelId, hotelId, hotelId, hotelId]
    );
    if (historial.n > 0) {
      const error = new ErrorNegocio(
        `El hotel tiene ${historial.n} registro(s) de historial (estancias, cobros, reservas…). ` +
        'Para conservar la contabilidad no se elimina físicamente: use la desactivación.'
      );
      error.ofrecerDesactivacion = true;
      throw error;
    }

    // Limpio: borra la estructura y el hotel
    await cx.query('DELETE FROM tarifas WHERE hotel_id = ?', [hotelId]);
    await cx.query('DELETE FROM productos WHERE hotel_id = ?', [hotelId]);
    await cx.query('DELETE FROM habitaciones WHERE hotel_id = ?', [hotelId]);
    await cx.query('DELETE FROM hoteles WHERE id = ?', [hotelId]);

    return { id: hotelId, nombre: hotel.nombre, dueno_id: hotel.dueno_id };
  });
}

module.exports = {
  listarDuenos,
  crearDueno,
  editarDueno,
  eliminarDueno,
  cambiarSuspension,
  registrarPago,
  pagosDeDueno,
  crearHotel,
  editarHotel,
  eliminarHotel,
  estadoCalculado,
  sumarUnMes
};
