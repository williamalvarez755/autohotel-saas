// ============================================================
// Consultas Avanzadas (superadmin): catálogo de consultas
// predefinidas con filtros dinámicos. Los resultados se muestran
// en la tabla reutilizable (buscar, ordenar, Excel, PDF, imprimir).
//
// El "cliente" del autohotel se identifica por PLACA (el sistema no
// guarda identidad de huéspedes por privacidad), por eso la consulta
// de clientes busca por placa sobre estancias.
// ============================================================

const CONSULTAS = [
  { tipo: 'clientes', categoria: 'Clientes', titulo: 'Clientes por placa',
    desc: 'Estancias por placa de vehículo, hotel y fechas', icono: 'carro',
    filtros: ['fechas', 'hotel', 'busqueda'], placeholder: 'Placa del vehículo…' },

  { tipo: 'reservas', categoria: 'Reservas', titulo: 'Reservas',
    desc: 'Entre fechas, por estado, hotel, habitación o placa', icono: 'calendario',
    filtros: ['fechas', 'hotel', 'estado', 'busqueda'], placeholder: 'Placa o habitación…',
    estados: [['todas', 'Todas'], ['pendiente', 'Pendientes'], ['usada', 'Usadas'], ['cancelada', 'Canceladas']] },

  { tipo: 'ventas_dia', categoria: 'Ventas', titulo: 'Ventas por día',
    desc: 'Total diario por hotel y método de pago', icono: 'dinero', filtros: ['fechas', 'hotel'] },
  { tipo: 'ventas_mes', categoria: 'Ventas', titulo: 'Ventas por mes',
    desc: 'Total mensual por hotel', icono: 'dinero', filtros: ['fechas', 'hotel'] },
  { tipo: 'ventas_anio', categoria: 'Ventas', titulo: 'Ventas por año',
    desc: 'Total anual por hotel', icono: 'dinero', filtros: ['fechas', 'hotel'] },
  { tipo: 'ventas_metodo', categoria: 'Ventas', titulo: 'Ventas por método',
    desc: 'Efectivo vs transferencia por hotel', icono: 'banco', filtros: ['fechas', 'hotel'] },

  { tipo: 'habitaciones', categoria: 'Habitaciones', titulo: 'Habitaciones por estado',
    desc: 'Ocupadas, disponibles, en limpieza o reservadas', icono: 'cama',
    filtros: ['hotel', 'estado'],
    estados: [['todas', 'Todas'], ['disponible', 'Disponibles'], ['ocupada', 'Ocupadas'],
      ['limpieza', 'En limpieza'], ['reservada', 'Reservadas']] },

  { tipo: 'inventario_bajo', categoria: 'Inventario', titulo: 'Bajo stock',
    desc: 'Productos en o bajo su mínimo', icono: 'paquete', filtros: ['hotel'] },
  { tipo: 'inventario_top', categoria: 'Inventario', titulo: 'Más vendidos',
    desc: 'Ranking de productos por unidades', icono: 'grafica', filtros: ['fechas', 'hotel'] },
  { tipo: 'inventario_sin_movimiento', categoria: 'Inventario', titulo: 'Sin movimiento',
    desc: 'Sin ventas desde la fecha indicada', icono: 'paquete', filtros: ['corte', 'hotel'] },

  { tipo: 'usuarios', categoria: 'Usuarios', titulo: 'Usuarios y accesos',
    desc: 'Activos/inactivos, por hotel, últimos accesos', icono: 'usuarios',
    filtros: ['hotel', 'estado', 'busqueda'], placeholder: 'Nombre o usuario…',
    estados: [['todos', 'Todos'], ['activos', 'Activos'], ['inactivos', 'Inactivos']] },

  { tipo: 'auditoria', categoria: 'Auditoría', titulo: 'Auditoría',
    desc: 'Acciones administrativas (usuario, IP, fecha)', icono: 'escudo',
    filtros: ['fechas', 'busqueda'], placeholder: 'Acción, detalle o usuario…' }
];

let hotelesConsulta = [];
let consultaActiva = null;

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function cargarConsultas() {
  if (!hotelesConsulta.length) {
    const r = await api('/superadmin/consultas/hoteles');
    if (r.success) hotelesConsulta = r.data;
  }
  const seccion = document.getElementById('seccion-consultas');
  const categorias = [...new Set(CONSULTAS.map((c) => c.categoria))];

  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Consultas avanzadas</h2>
        <div class="sub">Consulte cualquier dato sin entrar a la base — elija una consulta y sus filtros</div>
      </div>
    </div>
    ${categorias.map((cat) => `
      <div class="panel">
        <h3>${escapar(cat)}</h3>
        <div class="malla-consultas">
          ${CONSULTAS.filter((c) => c.categoria === cat).map((c) => `
            <button class="tarjeta-consulta" data-tipo="${c.tipo}">
              <div class="tc-titulo">${icono(c.icono, 16)} ${escapar(c.titulo)}</div>
              <div class="tc-desc">${escapar(c.desc)}</div>
            </button>`).join('')}
        </div>
      </div>`).join('')}
    <div id="consulta-filtros"></div>
    <div id="consulta-resultado"></div>`;

  seccion.querySelectorAll('[data-tipo]').forEach((boton) => {
    boton.addEventListener('click', () => seleccionarConsulta(boton.dataset.tipo));
  });
}

function seleccionarConsulta(tipo) {
  consultaActiva = CONSULTAS.find((c) => c.tipo === tipo);
  document.querySelectorAll('.tarjeta-consulta').forEach((t) =>
    t.classList.toggle('activa', t.dataset.tipo === tipo));

  const c = consultaActiva;
  const zonaFiltros = document.getElementById('consulta-filtros');
  const opcionesHotel = '<option value="">Todos los hoteles</option>' +
    hotelesConsulta.map((h) => `<option value="${h.id}">${escapar(h.nombre)} · ${escapar(h.dueno)}</option>`).join('');

  const campos = [];
  if (c.filtros.includes('fechas')) {
    campos.push(`<div class="campo" style="margin-bottom:0"><label>Desde</label><input type="date" id="cf-desde" value="${fechaHaceDias(90)}"></div>`);
    campos.push(`<div class="campo" style="margin-bottom:0"><label>Hasta</label><input type="date" id="cf-hasta" value="${hoyLocal()}"></div>`);
  }
  if (c.filtros.includes('corte')) {
    campos.push(`<div class="campo" style="margin-bottom:0"><label>Sin ventas desde</label><input type="date" id="cf-desde" value="${fechaHaceDias(60)}"></div>`);
  }
  if (c.filtros.includes('hotel')) {
    campos.push(`<div class="campo" style="margin-bottom:0"><label>Hotel</label><select id="cf-hotel">${opcionesHotel}</select></div>`);
  }
  if (c.filtros.includes('estado')) {
    campos.push(`<div class="campo" style="margin-bottom:0"><label>Estado</label><select id="cf-estado">${
      (c.estados || []).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>`);
  }
  if (c.filtros.includes('busqueda')) {
    campos.push(`<div class="campo" style="margin-bottom:0;flex:1;min-width:180px"><label>Buscar</label><input id="cf-busqueda" maxlength="100" placeholder="${escapar(c.placeholder || '')}"></div>`);
  }

  zonaFiltros.innerHTML = `
    <div class="panel">
      <h3>${icono(c.icono, 16)} ${escapar(c.titulo)}</h3>
      <div class="fila-flex" style="align-items:flex-end">
        ${campos.join('')}
        <button class="boton" id="cf-generar">${icono('lupa', 15)} Generar</button>
      </div>
    </div>`;
  document.getElementById('cf-generar').addEventListener('click', ejecutarConsulta);
  ejecutarConsulta();
}

async function ejecutarConsulta() {
  const c = consultaActiva;
  const params = new URLSearchParams();
  const val = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  if (val('cf-desde')) params.set('desde', val('cf-desde'));
  if (val('cf-hasta')) params.set('hasta', val('cf-hasta'));
  if (val('cf-hotel')) params.set('hotel_id', val('cf-hotel'));
  if (val('cf-estado')) params.set('estado', val('cf-estado'));
  if (val('cf-busqueda')) params.set('busqueda', val('cf-busqueda'));

  const respuesta = await api(`/superadmin/consultas/${c.tipo}?${params.toString()}`);
  const zona = document.getElementById('consulta-resultado');
  if (!respuesta.success) { avisoRespuesta(respuesta); return; }
  renderTablaResultados(zona, respuesta.data.filas, {
    titulo: c.titulo,
    nombreArchivo: c.tipo,
    vacio: 'Sin resultados para los filtros seleccionados'
  });
}
