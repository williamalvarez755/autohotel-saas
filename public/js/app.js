// ============================================================
// Núcleo del panel operativo (dueño y trabajador):
// - Sesión, navegación por secciones y selector de hotel.
// - Tablero de habitaciones con contadores en vivo.
// - Dashboard del dueño.
// - Alertas con campana y actualización automática (polling).
// ============================================================

const App = {
  sesion: null,
  esDueno: false,
  seccion: null,
  tablero: [],
  caja: null,             // caja abierta del trabajador (o null)
  deltaReloj: 0,          // diferencia reloj servidor - reloj navegador
  intervaloPolling: null,
  intervaloTicker: null,
  totalAlertas: 0
};

const INTERVALO_POLLING_MS = 25000;

/** Hora "del servidor" estimada (epoch ms) para contadores exactos. */
function ahoraServidor() {
  return Date.now() + App.deltaReloj;
}

// ============================================================
// Arranque
// ============================================================
(async function iniciar() {
  const respuesta = await api('/auth/sesion');
  if (!respuesta.success) return; // api.js redirige al login
  App.sesion = respuesta.data;

  if (App.sesion.rol === 'superadmin') {
    window.location.href = '/superadmin';
    return;
  }
  App.esDueno = App.sesion.rol === 'dueno';

  document.getElementById('nombre-usuario').textContent = App.sesion.nombre;
  document.getElementById('rol-usuario').textContent = App.esDueno ? 'Dueño' : 'Trabajador';
  const avatar = document.getElementById('avatar-usuario');
  if (avatar) {
    const partes = String(App.sesion.nombre || '').trim().split(/\s+/);
    avatar.textContent = (partes[0] ? partes[0][0] : '') + (partes[1] ? partes[1][0] : '');
  }

  construirSelectorHotel();
  construirNavegacion();

  document.getElementById('boton-salir').addEventListener('click', async () => {
    await apiPost('/auth/logout');
    window.location.href = '/';
  });
  document.getElementById('boton-alertas').addEventListener('click', modalAlertas);

  // Cambio de contraseña propia: solo dueños (los trabajadores la
  // administran a través de su dueño, en la sección Usuarios).
  const botonPassword = document.getElementById('boton-password');
  if (botonPassword && App.esDueno) {
    botonPassword.classList.remove('oculto');
    botonPassword.addEventListener('click', modalCambiarPassword);
  }

  // Control de caja: dueño y trabajador la operan desde la barra.
  const botonCaja = document.getElementById('boton-caja');
  if (botonCaja) {
    botonCaja.addEventListener('click', () => (App.caja ? modalCaja() : modalAbrirCaja()));
  }

  mostrarSeccion(App.esDueno ? 'dashboard' : 'tablero');
  await refrescarAlertas();

  // Ambos roles ven el estado de la caja; solo al trabajador se le
  // exige abrirla para poder operar (el dueño está exento).
  await cargarEstadoCaja();
  if (!App.esDueno && !App.caja) modalAbrirCaja();

  App.intervaloPolling = setInterval(cicloPolling, INTERVALO_POLLING_MS);
  App.intervaloTicker = setInterval(actualizarContadores, 1000);
})();

/** Polling: refresca alertas siempre y la sección visible si es "viva". */
async function cicloPolling() {
  if (document.hidden) return;
  await refrescarAlertas();
  await cargarEstadoCaja();
  if (App.seccion === 'tablero') await cargarTablero();
  if (App.seccion === 'dashboard') await cargarDashboard();
  if (App.seccion === 'estancias') await cargarEstancias();
  if (App.seccion === 'limpieza') await cargarLimpieza();
}

// ============================================================
// Selector de hotel (dueños con varios hoteles)
// ============================================================
function construirSelectorHotel() {
  const selector = document.getElementById('selector-hotel');
  selector.innerHTML = App.sesion.hoteles
    .map((h) => `<option value="${h.id}" ${h.id === App.sesion.hotel_activo_id ? 'selected' : ''}>${escapar(h.nombre)}</option>`)
    .join('');

  if (!App.esDueno || App.sesion.hoteles.length < 2) {
    selector.disabled = true;
    if (App.sesion.hoteles.length < 2) selector.style.opacity = '0.85';
  }

  selector.addEventListener('change', async () => {
    const respuesta = await apiPost('/auth/hotel-activo', { hotel_id: Number(selector.value) });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso('Hotel activo: ' + respuesta.data.nombre);
    construirNavegacion(); // refresca el pie con el hotel activo
    await refrescarAlertas();
    mostrarSeccion(App.seccion); // recarga la sección con el nuevo hotel
  });
}

// ============================================================
// Navegación
// ============================================================
const SECCIONES = [
  { id: 'dashboard',    icono: 'inicio',     texto: 'Inicio',       soloDueno: true,  grupo: 'Panel' },
  { id: 'tablero',      icono: 'cama',       texto: 'Tablero',      soloDueno: false, grupo: 'Operación' },
  { id: 'estancias',    icono: 'carro',      texto: 'Estancias',    soloDueno: false, grupo: 'Operación' },
  { id: 'limpieza',     icono: 'limpieza',   texto: 'Limpieza',     soloDueno: false, grupo: 'Operación' },
  { id: 'reservas',     icono: 'calendario', texto: 'Reservas',     soloDueno: false, grupo: 'Operación' },
  { id: 'inventario',   icono: 'paquete',    texto: 'Inventario',   soloDueno: false, grupo: 'Gestión' },
  { id: 'gastos',       icono: 'recibo',     texto: 'Gastos',       soloDueno: false, grupo: 'Gestión' },
  { id: 'reportes',     icono: 'grafica',    texto: 'Reportes',     soloDueno: true,  grupo: 'Gestión' },
  { id: 'caja',         icono: 'caja',       texto: 'Cajas',        soloDueno: true,  grupo: 'Gestión' },
  { id: 'usuarios',     icono: 'usuarios',   texto: 'Usuarios',     soloDueno: true,  grupo: 'Gestión' },
  { id: 'habitaciones', icono: 'puerta',     texto: 'Habitaciones', soloDueno: true,  grupo: 'Gestión' }
];

function construirNavegacion() {
  const nav = document.getElementById('navegacion');
  const visibles = SECCIONES.filter((s) => !s.soloDueno || App.esDueno);

  // Enlaces agrupados con título de sección (Panel / Operación / Gestión)
  let grupoAnterior = null;
  const piezas = [];
  visibles.forEach((s) => {
    if (s.grupo !== grupoAnterior) {
      piezas.push(`<div class="grupo-nav">${s.grupo}</div>`);
      grupoAnterior = s.grupo;
    }
    piezas.push(`<button class="enlace-nav" data-seccion="${s.id}">
                   <span class="ico">${icono(s.icono, 18)}</span><span>${s.texto}</span>
                 </button>`);
  });

  // Pie de la navegación: hotel activo (se relee al cambiar de hotel)
  const selector = document.getElementById('selector-hotel');
  const nombreHotel = selector && selector.selectedIndex >= 0
    ? selector.options[selector.selectedIndex].text
    : '';
  piezas.push(`
    <div class="pie-nav">
      <span class="ico-hotel">${icono('edificio', 17)}</span>
      <div class="datos">
        <div class="titulo-pie">Hotel activo</div>
        <div class="nombre-pie">${escapar(nombreHotel)}</div>
      </div>
    </div>`);

  nav.innerHTML = piezas.join('');
  nav.querySelectorAll('[data-seccion]').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSeccion(boton.dataset.seccion));
  });
}

const CARGADORES = {
  dashboard: cargarDashboard,
  tablero: cargarTablero,
  estancias: cargarEstancias,
  limpieza: cargarLimpieza,
  reservas: cargarReservas,
  inventario: cargarInventario,
  gastos: cargarGastos,
  reportes: cargarReportes,
  caja: cargarCajas,
  usuarios: cargarUsuarios,
  habitaciones: cargarHabitacionesAdmin
};

function mostrarSeccion(id) {
  App.seccion = id;
  document.querySelectorAll('main section').forEach((s) => s.classList.add('oculto'));
  document.getElementById('seccion-' + id).classList.remove('oculto');
  document.querySelectorAll('.enlace-nav').forEach((b) => {
    b.classList.toggle('activo', b.dataset.seccion === id);
  });
  CARGADORES[id]();
}

// ============================================================
// Contadores en vivo (se actualizan cada segundo sin recargar)
// ============================================================
function actualizarContadores() {
  const ahora = ahoraServidor();
  document.querySelectorAll('[data-tipo-contador]').forEach((el) => {
    const tipo = el.dataset.tipoContador;
    if (tipo === 'transcurrido') {
      el.textContent = formatoDuracion(ahora - Number(el.dataset.epoch));
    } else if (tipo === 'restante') {
      const restante = Number(el.dataset.epoch) - ahora;
      if (restante >= 0) {
        el.textContent = formatoDuracion(restante);
        el.classList.remove('excedido');
      } else {
        el.textContent = '+' + formatoDuracion(-restante);
        el.classList.add('excedido');
      }
    }
  });
  // Barras de progreso del tiempo contratado (solo presentación)
  document.querySelectorAll('[data-progreso]').forEach((el) => {
    const inicio = Number(el.dataset.inicio);
    const fin = Number(el.dataset.fin);
    if (!fin || fin <= inicio) return;
    const porcentaje = ((ahora - inicio) / (fin - inicio)) * 100;
    el.style.width = Math.min(100, Math.max(0, porcentaje)) + '%';
    el.classList.toggle('completo', porcentaje >= 100);
  });
}

// ============================================================
// Tablero de habitaciones
// ============================================================
async function cargarTablero() {
  const respuesta = await api('/habitaciones');
  if (!respuesta.success) return avisoRespuesta(respuesta);

  App.tablero = respuesta.data.habitaciones;
  App.deltaReloj = respuesta.data.ahora_epoch - Date.now();

  const seccion = document.getElementById('seccion-tablero');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Tablero de habitaciones</h2>
        <div class="sub">Toque una habitación para operar · se actualiza solo</div>
      </div>
      <button class="boton secundario chico" id="refrescar-tablero">${icono('refrescar', 14)} Actualizar</button>
    </div>
    <div class="leyenda">
      <span><span class="punto" style="background:var(--verde)"></span>Disponible</span>
      <span><span class="punto" style="background:var(--rojo)"></span>Ocupada</span>
      <span><span class="punto" style="background:var(--amarillo)"></span>Limpieza</span>
      <span><span class="punto" style="background:var(--morado)"></span>Reservada</span>
    </div>
    <div class="malla-habitaciones" id="malla-habitaciones"></div>`;

  document.getElementById('refrescar-tablero').addEventListener('click', cargarTablero);
  dibujarTablero();
}

function dibujarTablero() {
  const malla = document.getElementById('malla-habitaciones');
  if (!malla) return;

  if (!App.tablero.length) {
    malla.innerHTML = '<div class="vacio" style="grid-column:1/-1"><span class="ico">' + icono('puerta', 26) + '</span>No hay habitaciones. El dueño puede crearlas en la sección Habitaciones.</div>';
    return;
  }

  const ahora = ahoraServidor();
  malla.innerHTML = App.tablero.map((h) => {
    const excedida = h.estado === 'ocupada' && h.salida_prevista_epoch && ahora > h.salida_prevista_epoch;
    let cuerpo = '';
    let accion = '';

    if (h.estado === 'disponible') {
      const chipsTarifas = (h.tarifas || [])
        .slice(0, 3)
        .map((t) => `<span class="chip-tarifa">${t.horas}h · <strong>${formatoQ(t.precio)}</strong></span>`)
        .join('');
      const chipsExtras = (h.extras || [])
        .slice(0, 2)
        .map((x) => `<span class="chip-tarifa extra">＋ ${escapar(x.nombre)} <strong>${formatoQ(x.precio)}</strong></span>`)
        .join('');
      cuerpo = `
        <div class="detalle-hab">
          <div class="chips-tarifas">
            ${chipsTarifas || '<span class="chip-tarifa vacia">Sin tarifas</span>'}
            <span class="chip-tarifa noche">${icono('luna', 12)} <strong>${formatoQ(h.precio_noche)}</strong></span>
            ${chipsExtras}
          </div>
        </div>`;
      accion = 'Registrar entrada';
    } else if (h.estado === 'ocupada') {
      cuerpo = `
        <div class="detalle-hab">
          <div>Placa: <strong>${escapar(h.placa) || '—'}</strong> · ${escapar(h.tarifa_nombre) || (h.tipo === 'noche' ? 'Noche' : h.horas_contratadas + ' h')}</div>
          ${h.pagado_base ? '' : '<div style="margin-top:4px"><span class="etiqueta amarilla">Cobro base pendiente</span></div>'}
        </div>
        <div class="contador" data-tipo-contador="transcurrido" data-epoch="${h.entrada_epoch}">00:00:00</div>
        <div class="progreso-hab"><span class="progreso-relleno${excedida ? ' completo' : ''}" data-progreso data-inicio="${h.entrada_epoch}" data-fin="${h.salida_prevista_epoch}"></span></div>
        <div class="limite">Límite ${formatoHora(h.hora_salida_prevista)} · <span data-tipo-contador="restante" data-epoch="${h.salida_prevista_epoch}"></span></div>`;
      accion = excedida ? 'Cobrar y finalizar' : 'Gestionar estancia';
    } else if (h.estado === 'limpieza') {
      cuerpo = `
        <div class="detalle-hab">En limpieza desde hace</div>
        <div class="contador">${formatoMinutos(h.minutos_limpieza || 0)}</div>`;
      accion = 'Marcar como limpia';
    } else if (h.estado === 'reservada') {
      cuerpo = `
        <div class="detalle-hab">
          <div>Reserva: <strong>${h.reserva_fecha_hora ? formatoFechaHora(h.reserva_fecha_hora) : '—'}</strong></div>
          ${h.reserva_placa ? `<div>Placa: <strong>${escapar(h.reserva_placa)}</strong></div>` : ''}
        </div>`;
      accion = 'Gestionar reserva';
    }

    return `
      <div class="tarjeta-habitacion ${h.estado} ${excedida ? 'excedida' : ''}" data-habitacion="${h.id}">
        <div class="cabecera-hab">
          <span class="nombre-hab">${escapar(h.nombre)}</span>
          <span class="insignia-estado">${h.estado}</span>
        </div>
        <div class="cuerpo-hab">${cuerpo}</div>
        <div class="accion-hab"><span>${accion}</span>${icono('flecha', 14)}</div>
      </div>`;
  }).join('');

  malla.querySelectorAll('[data-habitacion]').forEach((tarjeta) => {
    tarjeta.addEventListener('click', () => {
      const habitacion = App.tablero.find((x) => x.id === Number(tarjeta.dataset.habitacion));
      if (habitacion) accionHabitacion(habitacion);
    });
  });
  actualizarContadores();
}

/** Acción al tocar una tarjeta según su estado. */
function accionHabitacion(habitacion) {
  // La limpieza siempre está disponible; el resto exige caja abierta.
  if (habitacion.estado === 'limpieza') return modalLimpieza(habitacion);
  if (!requiereCaja()) return;
  if (habitacion.estado === 'disponible') return modalEntrada(habitacion, null);
  if (habitacion.estado === 'ocupada') return modalEstancia(habitacion);
  if (habitacion.estado === 'reservada') return modalReservaHabitacion(habitacion);
}

// ============================================================
// Dashboard del dueño
// ============================================================
async function cargarDashboard() {
  const respuesta = await api('/dashboard');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const d = respuesta.data;

  const seccion = document.getElementById('seccion-dashboard');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Resumen de hoy</h2>
        <div class="sub">${formatoFecha(d.fecha)} · datos del hotel seleccionado</div>
      </div>
    </div>

    <div class="malla-resumen">
      <div class="tarjeta-resumen dorada">
        <div class="icono-chip">${icono('dinero', 20)}</div>
        <div class="titulo">Ingresos del día</div>
        <div class="valor monto">${formatoQ(d.ingresos_dia.total)}</div>
        <div class="extra">Habitaciones ${formatoQ(d.ingresos_dia.habitaciones)} · Pedidos ${formatoQ(d.ingresos_dia.pedidos)}</div>
      </div>
      <div class="tarjeta-resumen">
        <div class="icono-chip">${icono('carro', 20)}</div>
        <div class="titulo">Clientes del día</div>
        <div class="valor">${d.clientes_dia}</div>
        <div class="extra">Estancias registradas hoy</div>
      </div>
      <div class="tarjeta-resumen">
        <div class="icono-chip">${icono('cama', 20)}</div>
        <div class="titulo">Ocupación actual</div>
        <div class="valor">${d.habitaciones.ocupada} <span class="suave" style="font-size:15px">ocupadas</span></div>
        <div class="extra">${d.habitaciones.disponible} disponibles · ${d.habitaciones.limpieza} en limpieza · ${d.habitaciones.reservada} reservadas</div>
      </div>
      <div class="tarjeta-resumen">
        <div class="icono-chip">${d.alertas.total ? icono('alerta', 20) : icono('check', 20)}</div>
        <div class="titulo">Alertas activas</div>
        <div class="valor" style="color:${d.alertas.total ? 'var(--rojo)' : 'var(--verde)'}">${d.alertas.total}</div>
        <div class="extra">${d.alertas.tiempo_excedido.length} tiempo excedido · ${d.alertas.limpieza_pendiente.length} limpieza · ${d.alertas.bajo_stock.length} bajo stock</div>
      </div>
    </div>

    <div class="panel">
      <h3>Accesos rápidos</h3>
      <div class="malla-accesos">
        <button class="acceso-rapido" data-ir="tablero"><span class="ico">${icono('cama', 19)}</span>Tablero</button>
        <button class="acceso-rapido" data-ir="reportes"><span class="ico">${icono('grafica', 19)}</span>Ver reportes</button>
        <button class="acceso-rapido" data-ir="inventario"><span class="ico">${icono('paquete', 19)}</span>Inventario</button>
        <button class="acceso-rapido" data-ir="usuarios"><span class="ico">${icono('usuarios', 19)}</span>Usuarios</button>
      </div>
    </div>

    <div class="panel">
      <h3>Alertas</h3>
      <div id="dashboard-alertas">${htmlListaAlertas(d.alertas)}</div>
    </div>`;

  seccion.querySelectorAll('[data-ir]').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSeccion(boton.dataset.ir));
  });
}

// ============================================================
// Alertas (campana + modal + lista)
// ============================================================
async function refrescarAlertas() {
  const respuesta = await api('/alertas');
  if (!respuesta.success) return;
  App.alertas = respuesta.data;
  App.totalAlertas = respuesta.data.total;
  const globo = document.getElementById('globo-alertas');
  globo.textContent = App.totalAlertas;
  globo.classList.toggle('oculto', App.totalAlertas === 0);
}

function htmlListaAlertas(alertas) {
  const piezas = [];
  alertas.tiempo_excedido.forEach((a) => {
    piezas.push(`<div class="alerta-item"><span class="ico">${icono('reloj', 16)}</span><div>
      <strong>${escapar(a.habitacion_nombre)}</strong> — tiempo excedido (${escapar(a.placa) ? 'placa ' + escapar(a.placa) : 'sin placa'})
      <div class="detalle">Debió salir a las ${formatoHora(a.hora_salida_prevista)} · lleva ${formatoMinutos(a.minutos_excedidos)} de más</div>
    </div></div>`);
  });
  alertas.limpieza_pendiente.forEach((a) => {
    piezas.push(`<div class="alerta-item amarilla"><span class="ico">${icono('limpieza', 16)}</span><div>
      <strong>${escapar(a.habitacion_nombre)}</strong> — sin limpiar
      <div class="detalle">Lleva ${formatoMinutos(a.minutos)} en limpieza</div>
    </div></div>`);
  });
  alertas.bajo_stock.forEach((a) => {
    piezas.push(`<div class="alerta-item azul"><span class="ico">${icono('paquete', 16)}</span><div>
      <strong>${escapar(a.nombre)}</strong> — bajo stock
      <div class="detalle">Quedan ${a.stock} unidades (mínimo ${a.stock_minimo})</div>
    </div></div>`);
  });
  return piezas.length
    ? `<div class="lista-alertas">${piezas.join('')}</div>`
    : '<div class="vacio" style="padding:18px"><span class="ico">' + icono('check', 24) + '</span>Sin alertas activas</div>';
}

async function modalAlertas() {
  await refrescarAlertas();
  abrirModal({
    titulo: `Alertas activas (${App.totalAlertas})`,
    ancho: true,
    cuerpo: htmlListaAlertas(App.alertas || { tiempo_excedido: [], limpieza_pendiente: [], bajo_stock: [], total: 0 }),
    pie: '<button class="boton secundario" id="ma-cerrar">Cerrar</button>'
  });
  document.getElementById('ma-cerrar').addEventListener('click', cerrarModal);
}
