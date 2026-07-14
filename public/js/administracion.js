// ============================================================
// Secciones de administración:
// - Inventario (dueño: control total / trabajador: entradas).
// - Reportes con gráficas (solo dueño).
// - Usuarios trabajadores (solo dueño).
// - Administración de habitaciones y precios (solo dueño).
// ============================================================

// ============================================================
// INVENTARIO
// ============================================================
async function cargarInventario() {
  const ruta = App.esDueno ? '/productos?todos=1' : '/productos';
  const respuesta = await api(ruta);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const productos = respuesta.data;

  const seccion = document.getElementById('seccion-inventario');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Inventario</h2>
        <div class="sub">${productos.filter((p) => p.activo).length} producto(s) activo(s)</div>
      </div>
      <div class="fila-flex">
        ${App.esDueno ? `<button class="boton secundario chico" id="ver-movimientos">${icono('portapapeles', 14)} Movimientos</button>` : ''}
        <button class="boton" id="nuevo-producto">${icono('mas', 15)} Nuevo producto</button>
      </div>
    </div>
    ${productos.length ? `
    <div class="buscador-pos" style="margin-bottom:12px">
      <span class="lupa">${icono('lupa', 16)}</span>
      <input id="inv-buscar" type="search" placeholder="Buscar producto…" autocomplete="off" spellcheck="false">
    </div>
    <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
      <thead><tr>
        <th>Producto</th><th class="derecha">Precio</th><th class="centrado">Stock</th>
        <th class="centrado">Mínimo</th><th>Estado</th><th></th>
      </tr></thead>
      <tbody>${productos.map((p) => `
        <tr style="${p.activo ? '' : 'opacity:.55'}" data-nombre-producto="${escapar(normalizarBusqueda(p.nombre))}">
          <td><strong>${escapar(p.nombre)}</strong>
            ${Number(p.precio) === 0 ? ' <span class="etiqueta amarilla">Sin precio</span>' : ''}</td>
          <td class="derecha monto">${formatoQ(p.precio)}</td>
          <td class="centrado"><strong>${p.stock}</strong></td>
          <td class="centrado suave">${p.stock_minimo}</td>
          <td>${!p.activo
            ? '<span class="etiqueta gris">Inactivo</span>'
            : (p.bajo_stock ? '<span class="etiqueta roja">Bajo stock</span>' : '<span class="etiqueta verde">OK</span>')}</td>
          <td class="derecha" style="white-space:nowrap">
            ${p.activo ? `<button class="boton exito mini" data-entrada="${p.id}">${icono('mas', 13)} Entrada</button>` : ''}
            ${App.esDueno ? `
              <button class="boton secundario mini" data-ajuste="${p.id}" ${p.activo ? '' : 'disabled'}>Ajustar</button>
              <button class="boton secundario mini" data-editar="${p.id}">Editar</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('paquete', 26) + '</span>No hay productos. Cree el primero con "Nuevo producto".</div>'}`;

  // Filtro instantáneo del inventario (sin recargar)
  const inputBuscarInv = document.getElementById('inv-buscar');
  if (inputBuscarInv) {
    inputBuscarInv.addEventListener('input', () => {
      const criterio = normalizarBusqueda(inputBuscarInv.value);
      seccion.querySelectorAll('[data-nombre-producto]').forEach((fila) => {
        fila.style.display = !criterio || fila.dataset.nombreProducto.includes(criterio) ? '' : 'none';
      });
    });
  }

  document.getElementById('nuevo-producto').addEventListener('click', () => modalProducto(null));
  const botonMovimientos = document.getElementById('ver-movimientos');
  if (botonMovimientos) botonMovimientos.addEventListener('click', modalMovimientos);

  seccion.querySelectorAll('[data-entrada]').forEach((b) => {
    b.addEventListener('click', () => modalEntradaMercaderia(productos.find((p) => p.id === Number(b.dataset.entrada))));
  });
  seccion.querySelectorAll('[data-ajuste]').forEach((b) => {
    b.addEventListener('click', () => modalAjusteStock(productos.find((p) => p.id === Number(b.dataset.ajuste))));
  });
  seccion.querySelectorAll('[data-editar]').forEach((b) => {
    b.addEventListener('click', () => modalProducto(productos.find((p) => p.id === Number(b.dataset.editar))));
  });
}

/** Alta (dueño y trabajador) o edición (solo dueño) de producto. */
function modalProducto(producto) {
  const esEdicion = Boolean(producto);
  abrirModal({
    titulo: esEdicion ? `Editar producto · ${escapar(producto.nombre)}` : 'Nuevo producto',
    cuerpo: `
      <div class="campo"><label>Nombre</label>
        <input id="mpr-nombre" maxlength="100" value="${esEdicion ? escapar(producto.nombre) : ''}"></div>
      <div class="fila-campos">
        <div class="campo"><label>Precio de venta (Q)</label>
          <input id="mpr-precio" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${esEdicion ? producto.precio : ''}" placeholder="0.00">
          ${!App.esDueno && !esEdicion ? '<div class="ayuda">Si no lo sabe, déjelo vacío: el dueño lo confirmará</div>' : ''}</div>
        ${esEdicion ? `
        <div class="campo"><label>Stock mínimo</label>
          <input id="mpr-minimo" type="number" min="0" inputmode="numeric" value="${producto.stock_minimo}"></div>`
        : `
        <div class="campo"><label>Stock inicial</label>
          <input id="mpr-stock" type="number" min="0" inputmode="numeric" value="0"></div>`}
      </div>
      ${esEdicion ? `
      <div class="campo"><label>Estado</label>
        <select id="mpr-activo">
          <option value="1" ${producto.activo ? 'selected' : ''}>Activo</option>
          <option value="0" ${!producto.activo ? 'selected' : ''}>Inactivo (no se vende)</option>
        </select></div>`
      : `
      <div class="campo"><label>Stock mínimo (alerta)</label>
        <input id="mpr-minimo" type="number" min="0" inputmode="numeric" value="0"></div>`}`,
    pie: `<button class="boton secundario" id="mpr-cancelar">Cancelar</button>
          <button class="boton" id="mpr-guardar">Guardar</button>`
  });

  document.getElementById('mpr-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mpr-guardar').addEventListener('click', async () => {
    let respuesta;
    if (esEdicion) {
      respuesta = await apiPut(`/productos/${producto.id}`, {
        nombre: valorModal('#mpr-nombre'),
        precio: Number(valorModal('#mpr-precio') || 0),
        stock_minimo: Number(valorModal('#mpr-minimo') || 0),
        activo: Number(valorModal('#mpr-activo'))
      });
    } else {
      respuesta = await apiPost('/productos', {
        nombre: valorModal('#mpr-nombre'),
        precio: valorModal('#mpr-precio') === '' ? undefined : Number(valorModal('#mpr-precio')),
        stock: Number(valorModal('#mpr-stock') || 0),
        stock_minimo: Number(valorModal('#mpr-minimo') || 0)
      });
    }
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarInventario(); refrescarAlertas(); }
  });
}

/** Entrada de mercadería (suma stock). Disponible para ambos roles. */
function modalEntradaMercaderia(producto) {
  abrirModal({
    titulo: `Entrada de mercadería · ${escapar(producto.nombre)}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Stock actual</span><strong>${producto.stock} unidades</strong></div>
      </div>
      <div class="campo"><label>Cantidad que ingresa</label>
        <input id="mem-cantidad" type="number" min="1" inputmode="numeric" placeholder="0"></div>
      <div class="campo"><label>Motivo</label>
        <input id="mem-motivo" maxlength="200" placeholder="Ej.: llegó camión del proveedor"></div>
      <div class="ayuda suave">La entrada quedará registrada con su usuario para auditoría del dueño.</div>`,
    pie: `<button class="boton secundario" id="mem-cancelar">Cancelar</button>
          <button class="boton exito" id="mem-guardar">Registrar entrada</button>`
  });
  document.getElementById('mem-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mem-guardar').addEventListener('click', async () => {
    const respuesta = await apiPost(`/productos/${producto.id}/entrada`, {
      cantidad: Number(valorModal('#mem-cantidad')),
      motivo: valorModal('#mem-motivo')
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso(`Stock actualizado: ${respuesta.data.stock} unidades`);
    cerrarModal();
    await cargarInventario();
    refrescarAlertas();
  });
}

/** Ajuste manual de stock, en ambas direcciones (solo dueño). */
function modalAjusteStock(producto) {
  abrirModal({
    titulo: `Ajustar stock · ${escapar(producto.nombre)}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Stock actual</span><strong>${producto.stock} unidades</strong></div>
      </div>
      <div class="campo"><label>Tipo de ajuste</label>
        <div class="grupo-opciones" id="maj-direccion">
          <button type="button" class="opcion activa" data-valor="sumar">${icono('mas', 14)} Sumar</button>
          <button type="button" class="opcion" data-valor="restar">${icono('menos', 14)} Restar</button>
        </div></div>
      <div class="campo"><label>Cantidad</label>
        <input id="maj-cantidad" type="number" min="1" inputmode="numeric" placeholder="0"></div>
      <div class="campo"><label>Motivo (obligatorio)</label>
        <input id="maj-motivo" maxlength="200" placeholder="Ej.: conteo físico, producto dañado"></div>`,
    pie: `<button class="boton secundario" id="maj-cancelar">Cancelar</button>
          <button class="boton" id="maj-guardar">Aplicar ajuste</button>`
  });
  activarGrupoOpciones(document.getElementById('maj-direccion'));
  document.getElementById('maj-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('maj-guardar').addEventListener('click', async () => {
    const respuesta = await apiPost(`/productos/${producto.id}/ajuste`, {
      direccion: opcionActiva(document.getElementById('maj-direccion')),
      cantidad: Number(valorModal('#maj-cantidad')),
      motivo: valorModal('#maj-motivo')
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso(`Stock ajustado: ${respuesta.data.stock} unidades`);
    cerrarModal();
    await cargarInventario();
    refrescarAlertas();
  });
}

/** Historial de movimientos (auditoría del dueño). */
async function modalMovimientos() {
  const respuesta = await api('/productos/movimientos');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const movimientos = respuesta.data;

  const etiquetaTipo = {
    entrada: '<span class="etiqueta verde">Entrada</span>',
    salida: '<span class="etiqueta roja">Salida</span>',
    ajuste_positivo: '<span class="etiqueta azul">Ajuste +</span>',
    ajuste_negativo: '<span class="etiqueta amarilla">Ajuste −</span>'
  };

  abrirModal({
    titulo: 'Movimientos de inventario (últimos 300)',
    ancho: true,
    cuerpo: movimientos.length ? `
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th class="centrado">Cant.</th><th>Usuario</th><th>Motivo</th></tr></thead>
        <tbody>${movimientos.map((m) => `
          <tr>
            <td style="white-space:nowrap">${formatoFechaHora(m.fecha)}</td>
            <td>${escapar(m.producto_nombre)}</td>
            <td>${etiquetaTipo[m.tipo] || escapar(m.tipo)}</td>
            <td class="centrado"><strong>${m.cantidad}</strong></td>
            <td class="suave">${escapar(m.usuario_nombre)}</td>
            <td class="suave">${escapar(m.motivo)}</td>
          </tr>`).join('')}
        </tbody></table></div>`
      : '<div class="vacio"><span class="ico">' + icono('portapapeles', 26) + '</span>Sin movimientos registrados</div>',
    pie: '<button class="boton secundario" id="mm-cerrar">Cerrar</button>'
  });
  document.getElementById('mm-cerrar').addEventListener('click', cerrarModal);
}

// ============================================================
// REPORTES (solo dueño)
// ============================================================
let graficaActual = null;

async function cargarReportes() {
  const seccion = document.getElementById('seccion-reportes');
  const hoy = hoyLocal();
  const hace7 = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Reportes</h2>
        <div class="sub">Ingresos según cobros reales registrados</div>
      </div>
    </div>
    <div class="panel">
      <div class="fila-flex" style="align-items:flex-end">
        <div class="campo" style="margin-bottom:0"><label>Desde</label>
          <input type="date" id="rep-desde" value="${hace7}"></div>
        <div class="campo" style="margin-bottom:0"><label>Hasta</label>
          <input type="date" id="rep-hasta" value="${hoy}"></div>
        <div class="campo" style="margin-bottom:0"><label>Habitación</label>
          <select id="rep-habitacion"><option value="">Todas</option></select></div>
        <button class="boton" id="rep-generar">Generar</button>
      </div>
      <div class="fila-flex" style="margin-top:12px">
        <button class="boton secundario chico rep-tab activo-tab" data-tab="dias">Ingresos por día</button>
        <button class="boton secundario chico rep-tab" data-tab="habitaciones">Por habitación</button>
        <button class="boton secundario chico rep-tab" data-tab="productos">Productos más vendidos</button>
        <button class="boton secundario chico rep-tab" data-tab="estancias">Estancias</button>
      </div>
    </div>
    <div class="panel"><div class="contenedor-grafica"><canvas id="rep-grafica"></canvas></div></div>
    <div id="rep-resultado"></div>`;

  // Llena el filtro de habitaciones
  const habitacionesRespuesta = await api('/habitaciones');
  if (habitacionesRespuesta.success) {
    document.getElementById('rep-habitacion').innerHTML =
      '<option value="">Todas</option>' +
      habitacionesRespuesta.data.habitaciones
        .map((h) => `<option value="${h.id}">${escapar(h.nombre)}</option>`).join('');
  }

  let tabActiva = 'dias';
  seccion.querySelectorAll('.rep-tab').forEach((boton) => {
    boton.addEventListener('click', () => {
      tabActiva = boton.dataset.tab;
      seccion.querySelectorAll('.rep-tab').forEach((b) => b.classList.remove('activo-tab'));
      seccion.querySelectorAll('.rep-tab').forEach((b) => (b.style.borderColor = ''));
      boton.classList.add('activo-tab');
      generar();
    });
  });
  document.getElementById('rep-generar').addEventListener('click', () => generar());

  async function generar() {
    const desde = document.getElementById('rep-desde').value;
    const hasta = document.getElementById('rep-hasta').value;
    const habitacionId = document.getElementById('rep-habitacion').value;
    const filtroHabitacion = habitacionId ? `&habitacion_id=${habitacionId}` : '';
    const resultado = document.getElementById('rep-resultado');
    const zonaGrafica = document.querySelector('.contenedor-grafica').parentElement;

    seccion.querySelectorAll('.rep-tab').forEach((b) => {
      b.style.borderColor = b.dataset.tab === tabActiva ? 'var(--acento)' : '';
      b.style.color = b.dataset.tab === tabActiva ? 'var(--acento)' : '';
    });

    if (tabActiva === 'dias') {
      const r = await api(`/reportes/ingresos-dia?desde=${desde}&hasta=${hasta}`);
      if (!r.success) return avisoRespuesta(r);
      zonaGrafica.classList.remove('oculto');
      dibujarGrafica('bar', r.data.dias.map((d) => formatoFecha(d.dia)), [
        { label: 'Habitaciones', data: r.data.dias.map((d) => d.habitaciones), backgroundColor: '#3B82F6', borderRadius: 6, maxBarThickness: 36 },
        { label: 'Pedidos', data: r.data.dias.map((d) => d.pedidos), backgroundColor: '#22C55E', borderRadius: 6, maxBarThickness: 36 }
      ], true);
      resultado.innerHTML = tablaPanel(`
        <thead><tr><th>Día</th><th class="derecha">Habitaciones</th><th class="derecha">Pedidos</th>
          <th class="derecha">Total</th><th class="centrado">Cobros</th></tr></thead>
        <tbody>${r.data.dias.map((d) => `
          <tr><td>${formatoFecha(d.dia)}</td>
              <td class="derecha monto">${formatoQ(d.habitaciones)}</td>
              <td class="derecha monto">${formatoQ(d.pedidos)}</td>
              <td class="derecha monto"><strong>${formatoQ(d.total)}</strong></td>
              <td class="centrado">${d.cobros}</td></tr>`).join('')}
          <tr class="total"><td>Total</td>
            <td class="derecha monto">${formatoQ(r.data.totales.habitaciones)}</td>
            <td class="derecha monto">${formatoQ(r.data.totales.pedidos)}</td>
            <td class="derecha monto">${formatoQ(r.data.totales.total)}</td>
            <td class="centrado">${r.data.totales.cobros}</td></tr>
        </tbody>`, r.data.dias.length);
    }

    if (tabActiva === 'habitaciones') {
      const r = await api(`/reportes/ingresos-habitacion?desde=${desde}&hasta=${hasta}${filtroHabitacion}`);
      if (!r.success) return avisoRespuesta(r);
      zonaGrafica.classList.remove('oculto');
      dibujarGrafica('bar', r.data.map((h) => h.nombre), [
        { label: 'Total (Q)', data: r.data.map((h) => h.total), backgroundColor: '#F59E0B', borderRadius: 6, maxBarThickness: 36 }
      ]);
      resultado.innerHTML = tablaPanel(`
        <thead><tr><th>Habitación</th><th class="centrado">Estancias</th><th class="derecha">Habitación</th>
          <th class="derecha">Pedidos</th><th class="derecha">Total</th></tr></thead>
        <tbody>${r.data.map((h) => `
          <tr><td><strong>${escapar(h.nombre)}</strong></td>
              <td class="centrado">${h.estancias}</td>
              <td class="derecha monto">${formatoQ(h.habitacion)}</td>
              <td class="derecha monto">${formatoQ(h.pedidos)}</td>
              <td class="derecha monto"><strong>${formatoQ(h.total)}</strong></td></tr>`).join('')}
        </tbody>`, r.data.length);
    }

    if (tabActiva === 'productos') {
      const r = await api(`/reportes/productos-vendidos?desde=${desde}&hasta=${hasta}`);
      if (!r.success) return avisoRespuesta(r);
      zonaGrafica.classList.remove('oculto');
      dibujarGrafica('bar', r.data.map((p) => p.nombre), [
        { label: 'Unidades vendidas', data: r.data.map((p) => p.unidades), backgroundColor: '#8B5CF6', borderRadius: 6, maxBarThickness: 36 }
      ]);
      resultado.innerHTML = tablaPanel(`
        <thead><tr><th>Producto</th><th class="centrado">Unidades</th><th class="derecha">Total vendido</th></tr></thead>
        <tbody>${r.data.map((p) => `
          <tr><td><strong>${escapar(p.nombre)}</strong></td>
              <td class="centrado">${p.unidades}</td>
              <td class="derecha monto">${formatoQ(p.total)}</td></tr>`).join('')}
        </tbody>`, r.data.length);
    }

    if (tabActiva === 'estancias') {
      const r = await api(`/reportes/estancias?desde=${desde}&hasta=${hasta}${filtroHabitacion}`);
      if (!r.success) return avisoRespuesta(r);
      zonaGrafica.classList.add('oculto');
      resultado.innerHTML = tablaPanel(`
        <thead><tr><th>Habitación</th><th>Placa</th><th>Entrada</th><th>Salida</th>
          <th>Tipo</th><th class="centrado">Extra</th><th class="derecha">Habitación</th>
          <th class="derecha">Cargo</th>
          <th class="derecha">Pedidos</th><th class="derecha">Total</th><th>Estado</th></tr></thead>
        <tbody>${r.data.map((e) => `
          <tr><td><strong>${escapar(e.habitacion_nombre)}</strong></td>
              <td>${escapar(e.placa)}</td>
              <td style="white-space:nowrap">${formatoFechaHora(e.hora_entrada)}</td>
              <td style="white-space:nowrap">${e.hora_salida_real ? formatoFechaHora(e.hora_salida_real) : '—'}</td>
              <td>${e.tipo === 'noche' ? 'Noche' : e.horas_contratadas + ' h'}</td>
              <td class="centrado">${e.horas_extra > 0 ? e.horas_extra + ' h' : '—'}</td>
              <td class="derecha monto">${formatoQ(e.total_habitacion)}</td>
              <td class="derecha monto">${Number(e.cargo_extra) > 0
                ? `<span title="${escapar(e.cargo_descripcion)}">${formatoQ(e.cargo_extra)}</span>`
                : '<span class="suave">—</span>'}</td>
              <td class="derecha monto">${formatoQ(e.total_pedidos)}</td>
              <td class="derecha monto"><strong>${formatoQ(e.total_final)}</strong></td>
              <td>${e.estado === 'activa' ? '<span class="etiqueta roja">Activa</span>' : '<span class="etiqueta verde">Finalizada</span>'}</td></tr>`).join('')}
        </tbody>`, r.data.length);
    }
  }

  function tablaPanel(interior, cantidadFilas) {
    if (!cantidadFilas) {
      return '<div class="vacio"><span class="ico">' + icono('grafica', 26) + '</span>Sin datos en el rango seleccionado</div>';
    }
    return `<div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">${interior}</table></div>`;
  }

  function dibujarGrafica(tipo, etiquetas, series, apilada = false) {
    if (typeof Chart === 'undefined') return; // sin internet: solo tablas
    const lienzo = document.getElementById('rep-grafica');
    if (!lienzo) return;
    if (graficaActual) graficaActual.destroy();
    // Colores del tema activo (oscuro o claro) leídos del CSS
    const estilos = getComputedStyle(document.documentElement);
    const colorSuave = estilos.getPropertyValue('--texto-suave').trim() || '#94A3B8';
    const colorTexto = estilos.getPropertyValue('--texto').trim() || '#F8FAFC';
    const colorRejilla = 'rgba(148, 163, 184, 0.12)';
    graficaActual = new Chart(lienzo, {
      type: tipo,
      data: { labels: etiquetas, datasets: series },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: apilada, ticks: { color: colorSuave }, grid: { color: colorRejilla }, border: { display: false } },
          y: { stacked: apilada, ticks: { color: colorSuave }, grid: { color: colorRejilla }, border: { display: false } }
        },
        plugins: {
          legend: { labels: { color: colorTexto, usePointStyle: true, pointStyle: 'circle', boxHeight: 7, padding: 16 } }
        }
      }
    });
  }

  generar();
}

// ============================================================
// USUARIOS (solo dueño)
// ============================================================
async function cargarUsuarios() {
  const respuesta = await api('/usuarios');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const trabajadores = respuesta.data;

  const seccion = document.getElementById('seccion-usuarios');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Usuarios</h2>
        <div class="sub">Trabajadores de sus hoteles</div>
      </div>
      <button class="boton" id="nuevo-usuario">${icono('mas', 15)} Crear usuario</button>
    </div>
    ${trabajadores.length ? `
    <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
      <thead><tr><th>Nombre</th><th>Usuario</th><th>Hotel</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
      <tbody>${trabajadores.map((t) => `
        <tr style="${t.activo ? '' : 'opacity:.55'}">
          <td><strong>${escapar(t.nombre)}</strong></td>
          <td>${escapar(t.usuario)}</td>
          <td>${escapar(t.hotel_nombre)}</td>
          <td><span class="etiqueta azul">Trabajador</span></td>
          <td>${t.activo ? '<span class="etiqueta verde">Activo</span>' : '<span class="etiqueta gris">Desactivado</span>'}</td>
          <td class="derecha" style="white-space:nowrap">
            <button class="boton secundario mini" data-editar="${t.id}">Editar</button>
            ${t.activo
              ? `<button class="boton peligro mini" data-desactivar="${t.id}">Desactivar</button>`
              : `<button class="boton exito mini" data-reactivar="${t.id}">Reactivar</button>`}
          </td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('usuarios', 26) + '</span>Aún no tiene trabajadores registrados</div>'}`;

  document.getElementById('nuevo-usuario').addEventListener('click', () => modalUsuario(null));
  seccion.querySelectorAll('[data-editar]').forEach((b) => {
    b.addEventListener('click', () => modalUsuario(trabajadores.find((t) => t.id === Number(b.dataset.editar))));
  });
  seccion.querySelectorAll('[data-desactivar]').forEach((b) => {
    b.addEventListener('click', () => cambiarActivoUsuario(Number(b.dataset.desactivar), 0));
  });
  seccion.querySelectorAll('[data-reactivar]').forEach((b) => {
    b.addEventListener('click', () => cambiarActivoUsuario(Number(b.dataset.reactivar), 1));
  });
}

function modalUsuario(trabajador) {
  const esEdicion = Boolean(trabajador);
  abrirModal({
    titulo: esEdicion ? `Editar usuario · ${escapar(trabajador.nombre)}` : 'Crear usuario trabajador',
    cuerpo: `
      <div class="campo"><label>Nombre completo</label>
        <input id="mu-nombre" maxlength="100" value="${esEdicion ? escapar(trabajador.nombre) : ''}"></div>
      ${esEdicion ? '' : `
      <div class="campo"><label>Usuario de acceso</label>
        <input id="mu-usuario" maxlength="50" autocapitalize="none">
        <div class="ayuda">3 a 50 caracteres: letras, números, punto o guion</div></div>`}
      <div class="campo"><label>${esEdicion ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña'}</label>
        <input id="mu-password" type="password" maxlength="72">
        <div class="ayuda">Mínimo 6 caracteres</div></div>
      <div class="campo"><label>Hotel asignado</label>
        <select id="mu-hotel">
          ${App.sesion.hoteles.map((h) => `
            <option value="${h.id}" ${esEdicion && trabajador.hotel_id === h.id ? 'selected' : ''}>${escapar(h.nombre)}</option>`).join('')}
        </select></div>`,
    pie: `<button class="boton secundario" id="mu-cancelar">Cancelar</button>
          <button class="boton" id="mu-guardar">Guardar</button>`
  });

  document.getElementById('mu-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mu-guardar').addEventListener('click', async () => {
    const password = document.querySelector('.fondo-modal #mu-password').value;
    let respuesta;
    if (esEdicion) {
      respuesta = await apiPut(`/usuarios/${trabajador.id}`, {
        nombre: valorModal('#mu-nombre'),
        hotel_id: Number(valorModal('#mu-hotel')),
        password: password || undefined
      });
    } else {
      respuesta = await apiPost('/usuarios', {
        nombre: valorModal('#mu-nombre'),
        usuario: valorModal('#mu-usuario'),
        password,
        hotel_id: Number(valorModal('#mu-hotel'))
      });
    }
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarUsuarios(); }
  });
}

async function cambiarActivoUsuario(id, activo) {
  const respuesta = await apiPut(`/usuarios/${id}/activo`, { activo });
  avisoRespuesta(respuesta);
  await cargarUsuarios();
}

// ============================================================
// HABITACIONES · administración (solo dueño)
// Aquí el dueño define el menú de tarifas (precio/tiempo) de
// cada habitación, el precio de noche y la hora extra.
// ============================================================
async function cargarHabitacionesAdmin() {
  const respuesta = await api('/habitaciones/admin');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const habitaciones = respuesta.data;

  const seccion = document.getElementById('seccion-habitaciones');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Habitaciones y tarifas</h2>
        <div class="sub">Defina los paquetes precio/tiempo de cada habitación</div>
      </div>
      <button class="boton" id="nueva-habitacion">${icono('mas', 15)} Nueva habitación</button>
    </div>
    ${habitaciones.length ? `
    <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
      <thead><tr><th>Habitación</th><th>Tarifas por tiempo</th><th class="derecha">Noche</th>
        <th class="derecha">Hora extra</th><th>Estado actual</th><th>Activa</th><th></th></tr></thead>
      <tbody>${habitaciones.map((h) => `
        <tr style="${h.activo ? '' : 'opacity:.55'}">
          <td><strong>${escapar(h.nombre)}</strong></td>
          <td>
            <div class="chips-tarifas">
              ${(h.tarifas || []).map((t) => `<span class="chip-tarifa">${t.horas}h · <strong>${formatoQ(t.precio)}</strong></span>`).join('')
                || '<span class="etiqueta amarilla">Sin tarifas</span>'}
            </div>
          </td>
          <td class="derecha monto">${formatoQ(h.precio_noche)}</td>
          <td class="derecha monto">${formatoQ(h.precio_hora_extra)}</td>
          <td>${etiquetaEstadoHabitacion(h.estado)}</td>
          <td>${h.activo ? '<span class="etiqueta verde">Sí</span>' : '<span class="etiqueta gris">No</span>'}</td>
          <td class="derecha" style="white-space:nowrap">
            <button class="boton secundario mini" data-editar="${h.id}">Editar</button>
            ${h.estado !== 'ocupada' && h.activo ? `<button class="boton secundario mini" data-estado="${h.id}">Cambiar estado</button>` : ''}
          </td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('puerta', 26) + '</span>No hay habitaciones. Cree la primera.</div>'}`;

  document.getElementById('nueva-habitacion').addEventListener('click', () => modalHabitacion(null));
  seccion.querySelectorAll('[data-editar]').forEach((b) => {
    b.addEventListener('click', () => modalHabitacion(habitaciones.find((h) => h.id === Number(b.dataset.editar))));
  });
  seccion.querySelectorAll('[data-estado]').forEach((b) => {
    b.addEventListener('click', () => modalCambioEstadoManual(habitaciones.find((h) => h.id === Number(b.dataset.estado))));
  });
}

function etiquetaEstadoHabitacion(estado) {
  const mapa = {
    disponible: '<span class="etiqueta verde">Disponible</span>',
    ocupada: '<span class="etiqueta roja">Ocupada</span>',
    limpieza: '<span class="etiqueta amarilla">Limpieza</span>',
    reservada: '<span class="etiqueta morada">Reservada</span>'
  };
  return mapa[estado] || escapar(estado);
}

function modalHabitacion(habitacion) {
  const esEdicion = Boolean(habitacion);
  // Copia editable del menú de tarifas (o una fila inicial de ejemplo)
  const tarifas = esEdicion && habitacion.tarifas && habitacion.tarifas.length
    ? habitacion.tarifas.map((t) => ({ nombre: t.nombre, horas: t.horas, precio: t.precio }))
    : [{ nombre: '3 horas', horas: 3, precio: '' }];

  abrirModal({
    titulo: esEdicion ? `Editar habitación · ${escapar(habitacion.nombre)}` : 'Nueva habitación',
    ancho: true,
    cuerpo: `
      <div class="campo"><label>Nombre o número</label>
        <input id="mh-nombre" maxlength="50" value="${esEdicion ? escapar(habitacion.nombre) : ''}" placeholder="H-01, Suite 1..."></div>

      <div class="campo">
        <label>Tarifas por tiempo (paquetes precio/tiempo)</label>
        <div class="editor-tarifas" id="mh-tarifas"></div>
        <button type="button" class="boton secundario chico" id="mh-agregar-tarifa" style="margin-top:8px">${icono('mas', 14)} Agregar tarifa</button>
        <div class="ayuda">Ejemplo: "3 horas" = Q100, "6 horas" = Q160. El recepcionista elegirá una al registrar la entrada.</div>
      </div>

      <div class="fila-campos">
        <div class="campo"><label>Precio noche completa (Q)</label>
          <input id="mh-noche" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${esEdicion ? habitacion.precio_noche : ''}" placeholder="0.00"></div>
        <div class="campo"><label>Precio por hora extra (Q)</label>
          <input id="mh-extra" type="number" min="0" step="0.01" inputmode="decimal"
                 value="${esEdicion ? habitacion.precio_hora_extra : ''}" placeholder="0.00">
          <div class="ayuda">Se cobra por cada hora excedida sobre la salida prevista</div></div>
      </div>
      ${esEdicion ? `
      <div class="campo"><label>Activa</label>
        <select id="mh-activa">
          <option value="1" ${habitacion.activo ? 'selected' : ''}>Sí, en operación</option>
          <option value="0" ${!habitacion.activo ? 'selected' : ''}>No (fuera de servicio)</option>
        </select></div>` : ''}`,
    pie: `<button class="boton secundario" id="mh-cancelar">Cancelar</button>
          <button class="boton" id="mh-guardar">Guardar</button>`
  });

  const contenedorTarifas = document.getElementById('mh-tarifas');

  const dibujarTarifas = () => {
    contenedorTarifas.innerHTML = tarifas.map((t, i) => `
      <div class="fila-tarifa" data-indice="${i}">
        <input class="t-nombre" maxlength="60" placeholder="Nombre (ej. 3 horas)" value="${escapar(t.nombre)}">
        <input class="t-horas" type="number" min="1" max="24" inputmode="numeric" placeholder="Horas" value="${t.horas}">
        <input class="t-precio" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Q 0.00" value="${t.precio}">
        <button type="button" class="boton peligro mini t-quitar" title="Quitar tarifa" ${tarifas.length <= 1 ? 'disabled' : ''}>${icono('x', 13)}</button>
      </div>`).join('');

    contenedorTarifas.querySelectorAll('.fila-tarifa').forEach((fila) => {
      const i = Number(fila.dataset.indice);
      fila.querySelector('.t-nombre').addEventListener('input', (e) => { tarifas[i].nombre = e.target.value; });
      fila.querySelector('.t-horas').addEventListener('input', (e) => { tarifas[i].horas = e.target.value; });
      fila.querySelector('.t-precio').addEventListener('input', (e) => { tarifas[i].precio = e.target.value; });
      fila.querySelector('.t-quitar').addEventListener('click', () => {
        tarifas.splice(i, 1);
        dibujarTarifas();
      });
    });
  };
  dibujarTarifas();

  document.getElementById('mh-agregar-tarifa').addEventListener('click', () => {
    if (tarifas.length >= 8) return aviso('Máximo 8 tarifas por habitación', true);
    tarifas.push({ nombre: '', horas: '', precio: '' });
    dibujarTarifas();
    const filas = contenedorTarifas.querySelectorAll('.fila-tarifa');
    const ultima = filas[filas.length - 1];
    if (ultima) ultima.querySelector('.t-nombre').focus();
  });

  document.getElementById('mh-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mh-guardar').addEventListener('click', async () => {
    const datos = {
      nombre: valorModal('#mh-nombre'),
      precio_noche: Number(valorModal('#mh-noche') || 0),
      precio_hora_extra: Number(valorModal('#mh-extra') || 0),
      tarifas: tarifas.map((t) => ({
        nombre: String(t.nombre || '').trim(),
        horas: Number(t.horas),
        precio: Number(t.precio || 0)
      }))
    };
    let respuesta;
    if (esEdicion) {
      datos.activo = Number(valorModal('#mh-activa'));
      respuesta = await apiPut(`/habitaciones/${habitacion.id}`, datos);
    } else {
      respuesta = await apiPost('/habitaciones', datos);
    }
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarHabitacionesAdmin(); }
  });
}

/** Cambio manual de estado para casos especiales. */
function modalCambioEstadoManual(habitacion) {
  abrirModal({
    titulo: `Cambiar estado · ${escapar(habitacion.nombre)}`,
    cuerpo: `
      <p class="suave" style="font-size:13.5px;margin-bottom:12px">
        Estado actual: ${etiquetaEstadoHabitacion(habitacion.estado)}<br>
        Para casos especiales. No se puede ocupar una habitación manualmente
        (use el registro de entrada) ni liberar una ocupada (finalice la estancia).
        Si estaba reservada, la reserva pendiente se cancela.</p>
      <div class="grupo-opciones" id="mce-estado">
        <button type="button" class="opcion activa" data-valor="disponible"><span class="punto-opcion" style="background:var(--verde)"></span> Disponible</button>
        <button type="button" class="opcion" data-valor="limpieza"><span class="punto-opcion" style="background:var(--amarillo)"></span> Limpieza</button>
      </div>`,
    pie: `<button class="boton secundario" id="mce-cancelar">Cancelar</button>
          <button class="boton" id="mce-aplicar">Aplicar</button>`
  });
  activarGrupoOpciones(document.getElementById('mce-estado'));
  document.getElementById('mce-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mce-aplicar').addEventListener('click', async () => {
    const respuesta = await apiPut(`/habitaciones/${habitacion.id}/estado`, {
      estado: opcionActiva(document.getElementById('mce-estado'))
    });
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarHabitacionesAdmin(); refrescarAlertas(); }
  });
}
