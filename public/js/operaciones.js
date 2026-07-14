// ============================================================
// Operación diaria: registro de entrada, cobro base, pedidos,
// salida, limpieza y reservas. Todos los montos que se muestran
// vienen calculados del backend; el frontend solo los presenta.
// ============================================================

// ============================================================
// ENTRADA (habitación disponible o conversión de reserva)
// El menú de tarifas viene del backend (motor de tarifas por
// habitación); el precio y la duración los dicta la tarifa.
// ============================================================
function modalEntrada(habitacion, reserva) {
  const tarifas = habitacion.tarifas || [];
  if (!tarifas.length && Number(habitacion.precio_noche) <= 0) {
    return aviso('Esta habitación no tiene tarifas configuradas: el dueño debe definirlas en Habitaciones', true);
  }

  const botonesTarifas = tarifas.map((t, i) => `
    <button type="button" class="opcion tarifa ${i === 0 ? 'activa' : ''}" data-valor="tarifa-${t.id}">
      <span class="nombre-tarifa">${escapar(t.nombre)}</span>
      <span class="detalle-tarifa">${t.horas} h</span>
      <strong class="monto">${formatoQ(t.precio)}</strong>
    </button>`).join('');

  abrirModal({
    titulo: `Registrar entrada · ${escapar(habitacion.nombre)}`,
    cuerpo: `
      <div class="campo"><label>Placa del vehículo (opcional)</label>
        <input id="me-placa" maxlength="20" autocapitalize="characters" placeholder="P-123ABC · déjelo vacío si llegan a pie"
               value="${reserva && reserva.placa ? escapar(reserva.placa) : ''}"></div>
      <div class="campo"><label>Tarifa</label>
        <div class="grupo-opciones tarifas" id="me-tipo">
          ${botonesTarifas}
          <button type="button" class="opcion tarifa ${!tarifas.length ? 'activa' : ''}" data-valor="noche">
            <span class="nombre-tarifa">${icono('luna', 13)} Noche completa</span>
            <span class="detalle-tarifa">hasta el día siguiente</span>
            <strong class="monto">${formatoQ(habitacion.precio_noche)}</strong>
          </button>
        </div></div>
      <div class="desglose">
        <div class="linea"><span>Tiempo incluido</span><strong id="me-tiempo"></strong></div>
        <div class="linea"><span>Hora extra excedida</span><strong>${formatoQ(habitacion.precio_hora_extra)}</strong></div>
        ${reserva && Number(reserva.cargo_extra) > 0 ? `
        <div class="linea"><span>Cargo de la reserva${reserva.cargo_descripcion ? ` (${escapar(reserva.cargo_descripcion)})` : ''}</span>
          <strong class="monto">${formatoQ(reserva.cargo_extra)}</strong></div>` : ''}
        <div class="linea grande"><span>Total a cobrar</span><span class="monto" id="me-total"></span></div>
      </div>`,
    pie: `<button class="boton secundario" id="me-cancelar">Cancelar</button>
          <button class="boton" id="me-registrar">Registrar entrada</button>`
  });

  // El cargo de la reserva (si existe) se suma al total mostrado;
  // el backend lo calcula igual desde la reserva fotografiada.
  const cargoReserva = reserva ? Number(reserva.cargo_extra) || 0 : 0;
  const actualizarTotal = () => {
    const valor = opcionActiva(document.getElementById('me-tipo'));
    if (valor === 'noche') {
      document.getElementById('me-total').textContent = formatoQ(Number(habitacion.precio_noche) + cargoReserva);
      document.getElementById('me-tiempo').textContent = 'Noche completa';
      return;
    }
    const tarifa = tarifas.find((t) => `tarifa-${t.id}` === valor);
    if (tarifa) {
      document.getElementById('me-total').textContent = formatoQ(Number(tarifa.precio) + cargoReserva);
      document.getElementById('me-tiempo').textContent = `${tarifa.horas} hora${tarifa.horas > 1 ? 's' : ''} (${tarifa.nombre})`;
    }
  };
  activarGrupoOpciones(document.getElementById('me-tipo'), actualizarTotal);
  actualizarTotal();

  document.getElementById('me-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('me-registrar').addEventListener('click', async () => {
    const valor = opcionActiva(document.getElementById('me-tipo'));
    const cuerpo = {
      habitacion_id: habitacion.id,
      placa: valorModal('#me-placa').toUpperCase(),
      tipo: valor === 'noche' ? 'noche' : 'horas'
    };
    if (valor !== 'noche') cuerpo.tarifa_id = Number(valor.replace('tarifa-', ''));
    if (reserva) cuerpo.reserva_id = reserva.id || reserva.reserva_id;

    const respuesta = await apiPost('/estancias', cuerpo);
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso('Entrada registrada en ' + respuesta.data.habitacion_nombre);
    modalCobroBase(respuesta.data);   // directo a la pantalla de cobro
    refrescarVistaOperativa();
  });
}

// ============================================================
// COBRO BASE (adelantado)
// ============================================================
function modalCobroBase(estancia) {
  const cargoExtra = Number(estancia.cargo_extra) || 0;
  const totalCobro = Number(estancia.total_base) + cargoExtra;
  abrirModal({
    titulo: `Cobro · ${escapar(estancia.habitacion_nombre)}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Placa</span><strong>${escapar(estancia.placa) || '—'}</strong></div>
        <div class="linea"><span>Tarifa</span>
          <strong>${escapar(estancia.tarifa_nombre) || (estancia.tipo === 'noche' ? 'Noche completa' : estancia.horas_contratadas + ' hora(s)')} · ${estancia.horas_contratadas} h</strong></div>
        <div class="linea"><span>Salida prevista</span><strong>${formatoFechaHora(estancia.hora_salida_prevista)}</strong></div>
        ${cargoExtra > 0 ? `
        <div class="linea"><span>Habitación</span><span class="monto">${formatoQ(estancia.total_base)}</span></div>
        <div class="linea"><span>Cargo de reserva${estancia.cargo_descripcion ? ` (${escapar(estancia.cargo_descripcion)})` : ''}</span>
          <span class="monto">${formatoQ(cargoExtra)}</span></div>` : ''}
        <div class="linea grande"><span>Total a pagar</span><span class="monto">${formatoQ(totalCobro)}</span></div>
      </div>
      <div class="campo"><label>Método de pago</label>
        <div class="grupo-opciones" id="mc-metodo">
          <button type="button" class="opcion activa" data-valor="efectivo">${icono('dinero', 15)} Efectivo</button>
          <button type="button" class="opcion" data-valor="transferencia">${icono('banco', 15)} Transferencia</button>
        </div></div>
      <div class="campo" id="mc-campo-efectivo"><label>Efectivo recibido (Q)</label>
        <input id="mc-recibido" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
        <div class="cambio-grande oculto" id="mc-cambio"></div></div>`,
    pie: `<button class="boton secundario" id="mc-despues">Cobrar en la salida</button>
          <button class="boton" id="mc-confirmar">Confirmar pago</button>`
  });

  const total = totalCobro;
  const inputRecibido = document.getElementById('mc-recibido');
  const cajaCambio = document.getElementById('mc-cambio');

  const actualizarCambio = () => {
    const recibido = Number(inputRecibido.value);
    if (recibido >= total) {
      cajaCambio.textContent = 'Cambio: ' + formatoQ(recibido - total);
      cajaCambio.classList.remove('oculto');
    } else {
      cajaCambio.classList.add('oculto');
    }
  };
  inputRecibido.addEventListener('input', actualizarCambio);
  activarGrupoOpciones(document.getElementById('mc-metodo'), (valor) => {
    document.getElementById('mc-campo-efectivo').classList.toggle('oculto', valor !== 'efectivo');
  });

  document.getElementById('mc-despues').addEventListener('click', () => {
    aviso('El cobro base quedó pendiente: se liquidará en la salida', true);
    cerrarModal();
  });
  document.getElementById('mc-confirmar').addEventListener('click', async () => {
    const metodo = opcionActiva(document.getElementById('mc-metodo'));
    const cuerpo = { metodo };
    if (metodo === 'efectivo') cuerpo.efectivo_recibido = Number(inputRecibido.value);

    const respuesta = await apiPost(`/estancias/${estancia.id}/pago-base`, cuerpo);
    if (!respuesta.success) return avisoRespuesta(respuesta);

    if (respuesta.data.cambio !== null && respuesta.data.cambio > 0) {
      aviso(`Pago recibido. Cambio: ${formatoQ(respuesta.data.cambio)}`);
    } else {
      aviso('Pago recibido');
    }
    cerrarModal();
    refrescarVistaOperativa();
  });
}

// ============================================================
// ESTANCIA ACTIVA (habitación ocupada)
// ============================================================
async function modalEstancia(habitacion) {
  const respuesta = await api(`/estancias/${habitacion.estancia_id}`);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const { estancia, pedidos } = respuesta.data;

  abrirModal({
    titulo: `${escapar(estancia.habitacion_nombre)}${estancia.placa ? ' · Placa ' + escapar(estancia.placa) : ''}`,
    ancho: true,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Entrada</span><strong>${formatoFechaHora(estancia.hora_entrada)}</strong></div>
        <div class="linea"><span>Salida prevista</span><strong>${formatoFechaHora(estancia.hora_salida_prevista)}</strong></div>
        <div class="linea"><span>Tiempo transcurrido</span>
          <strong class="monto" data-tipo-contador="transcurrido" data-epoch="${estancia.entrada_epoch}"></strong></div>
        <div class="linea"><span>Tarifa</span>
          <strong>${escapar(estancia.tarifa_nombre) || (estancia.tipo === 'noche' ? 'Noche completa' : estancia.horas_contratadas + ' hora(s)')} · ${formatoQ(estancia.total_base)}</strong></div>
        ${Number(estancia.cargo_extra) > 0 ? `
        <div class="linea"><span>Cargo de reserva${estancia.cargo_descripcion ? ` (${escapar(estancia.cargo_descripcion)})` : ''}</span>
          <strong class="monto">${formatoQ(estancia.cargo_extra)}</strong></div>` : ''}
        <div class="linea"><span>Cobro base</span>
          ${estancia.pagado_base
            ? '<span class="etiqueta verde">Pagado</span>'
            : '<span class="etiqueta amarilla">Pendiente</span>'}</div>
        <div class="linea"><span>Pedidos acumulados</span><strong class="monto">${formatoQ(estancia.total_pedidos)}</strong></div>
      </div>
      ${pedidos.length ? `
      <div class="envoltura-tabla" style="margin-bottom:12px"><table class="tabla">
        <thead><tr><th>Producto</th><th class="centrado">Cant.</th><th class="derecha">Subtotal</th></tr></thead>
        <tbody>${pedidos.slice(0, 6).map((p) => `
          <tr><td>${escapar(p.producto_nombre)}</td>
              <td class="centrado">${p.cantidad}</td>
              <td class="derecha monto">${formatoQ(p.subtotal)}</td></tr>`).join('')}
        </tbody></table></div>` : ''}`,
    pie: `
      ${estancia.pagado_base ? '' : `<button class="boton" id="mes-cobrar">${icono('dinero', 15)} Cobrar base</button>`}
      <button class="boton secundario" id="mes-pedido">${icono('copa', 15)} Agregar pedido</button>
      <button class="boton peligro" id="mes-salida">Finalizar estancia</button>`
  });

  actualizarContadores();
  const botonCobrar = document.getElementById('mes-cobrar');
  if (botonCobrar) {
    botonCobrar.addEventListener('click', () => {
      modalCobroBase({
        id: estancia.id,
        habitacion_nombre: estancia.habitacion_nombre,
        placa: estancia.placa,
        tipo: estancia.tipo,
        tarifa_nombre: estancia.tarifa_nombre,
        horas_contratadas: estancia.horas_contratadas,
        hora_salida_prevista: estancia.hora_salida_prevista,
        total_base: estancia.total_base,
        cargo_extra: estancia.cargo_extra,
        cargo_descripcion: estancia.cargo_descripcion
      });
    });
  }
  document.getElementById('mes-pedido').addEventListener('click', () => modalPedidos(estancia));
  document.getElementById('mes-salida').addEventListener('click', () => modalSalida(estancia.id));
}

// ============================================================
// PEDIDOS (punto de venta de la estancia)
// Buscador instantáneo: el recepcionista teclea y la lista de
// productos se filtra al momento (sin recargar), ignorando
// mayúsculas y acentos. Enter selecciona la primera coincidencia.
// ============================================================
async function modalPedidos(estancia) {
  const [productosRespuesta, pedidosRespuesta] = await Promise.all([
    api('/productos'),
    api(`/estancias/${estancia.id}/pedidos`)
  ]);
  if (!productosRespuesta.success) return avisoRespuesta(productosRespuesta);
  if (!pedidosRespuesta.success) return avisoRespuesta(pedidosRespuesta);

  const productos = productosRespuesta.data.filter((p) => p.activo);
  let seleccionado = null;

  abrirModal({
    titulo: `Pedidos · ${escapar(estancia.habitacion_nombre)}${estancia.placa ? ` (${escapar(estancia.placa)})` : ''}`,
    ancho: true,
    cuerpo: `
      <div class="buscador-pos">
        <span class="lupa">${icono('lupa', 16)}</span>
        <input id="mp-buscar" type="search" placeholder="Buscar producto… (ej. cerveza, agua)"
               autocomplete="off" spellcheck="false">
      </div>
      <div class="lista-pos" id="mp-productos"></div>
      <div class="barra-pos">
        <div class="seleccion-pos" id="mp-seleccion">Seleccione un producto de la lista</div>
        <div class="controles-pos">
          <button type="button" class="boton secundario chico" id="mp-menos">−</button>
          <input id="mp-cantidad" type="number" min="1" value="1" inputmode="numeric">
          <button type="button" class="boton secundario chico" id="mp-mas">＋</button>
          <button class="boton" id="mp-agregar">Agregar</button>
        </div>
      </div>
      <div id="mp-lista"></div>`,
    pie: `<button class="boton secundario" id="mp-cerrar">Cerrar</button>`
  });

  const inputBuscar = document.getElementById('mp-buscar');
  const inputCantidad = document.getElementById('mp-cantidad');
  const contenedorProductos = document.getElementById('mp-productos');
  const cajaSeleccion = document.getElementById('mp-seleccion');

  const actualizarSeleccion = () => {
    if (!seleccionado) {
      cajaSeleccion.innerHTML = 'Seleccione un producto de la lista';
      return;
    }
    const cantidad = Math.max(1, Number(inputCantidad.value) || 1);
    const subtotal = Number(seleccionado.precio) * cantidad;
    cajaSeleccion.innerHTML = `
      <strong>${escapar(seleccionado.nombre)}</strong>
      <span class="suave">· ${formatoQ(seleccionado.precio)} c/u · stock ${seleccionado.stock}</span>
      <span class="subtotal-pos">${formatoQ(subtotal)}</span>`;
  };

  const dibujarProductos = () => {
    const criterio = normalizarBusqueda(inputBuscar.value);
    const visibles = criterio
      ? productos.filter((p) => normalizarBusqueda(p.nombre).includes(criterio))
      : productos;

    if (!visibles.length) {
      contenedorProductos.innerHTML =
        '<div class="vacio" style="padding:14px"><span class="ico">' + icono('lupa', 24) + '</span>Ningún producto coincide con la búsqueda</div>';
      return;
    }
    contenedorProductos.innerHTML = visibles.map((p) => `
      <button type="button" class="producto-pos ${seleccionado && seleccionado.id === p.id ? 'activo' : ''} ${p.stock === 0 ? 'agotado' : ''}"
              data-producto="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
        <span class="nombre">${escapar(p.nombre)}</span>
        <span class="precio monto">${formatoQ(p.precio)}</span>
        <span class="stock ${p.bajo_stock ? 'bajo' : ''}">${p.stock === 0 ? 'Agotado' : 'stock ' + p.stock}</span>
      </button>`).join('');

    contenedorProductos.querySelectorAll('[data-producto]').forEach((boton) => {
      boton.addEventListener('click', () => {
        seleccionado = productos.find((p) => p.id === Number(boton.dataset.producto));
        dibujarProductos();
        actualizarSeleccion();
        inputCantidad.select();
      });
    });
  };

  // Filtro instantáneo al teclear; Enter selecciona la primera coincidencia
  inputBuscar.addEventListener('input', dibujarProductos);
  inputBuscar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const primero = contenedorProductos.querySelector('[data-producto]:not([disabled])');
      if (primero) primero.click();
    }
  });
  inputCantidad.addEventListener('input', actualizarSeleccion);
  document.getElementById('mp-menos').addEventListener('click', () => {
    inputCantidad.value = Math.max(1, (Number(inputCantidad.value) || 1) - 1);
    actualizarSeleccion();
  });
  document.getElementById('mp-mas').addEventListener('click', () => {
    inputCantidad.value = (Number(inputCantidad.value) || 0) + 1;
    actualizarSeleccion();
  });

  const dibujarPedidos = (datos) => {
    document.getElementById('mp-lista').innerHTML = datos.pedidos.length ? `
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Producto</th><th class="centrado">Cant.</th><th class="derecha">Precio</th><th class="derecha">Subtotal</th><th>Hora</th></tr></thead>
        <tbody>${datos.pedidos.map((p) => `
          <tr><td>${escapar(p.producto_nombre)}</td>
              <td class="centrado">${p.cantidad}</td>
              <td class="derecha monto">${formatoQ(p.precio_unitario)}</td>
              <td class="derecha monto">${formatoQ(p.subtotal)}</td>
              <td class="suave">${formatoHora(p.fecha)}</td></tr>`).join('')}
        </tbody>
        <tr class="total"><td colspan="3">Total pedidos</td>
          <td class="derecha monto">${formatoQ(datos.total_pedidos)}</td><td></td></tr>
      </table></div>`
      : '<div class="vacio" style="padding:16px"><span class="ico">' + icono('recibo', 24) + '</span>Sin pedidos todavía</div>';
  };

  dibujarProductos();
  actualizarSeleccion();
  dibujarPedidos(pedidosRespuesta.data);
  setTimeout(() => inputBuscar.focus(), 80);

  document.getElementById('mp-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('mp-agregar').addEventListener('click', async () => {
    if (!seleccionado) return aviso('Seleccione un producto', true);
    const respuesta = await apiPost(`/estancias/${estancia.id}/pedidos`, {
      producto_id: seleccionado.id,
      cantidad: Number(inputCantidad.value)
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);

    aviso(`${respuesta.data.producto_nombre} ×${respuesta.data.cantidad} agregado (${formatoQ(respuesta.data.subtotal)})`);
    // Refleja el stock restante sin recargar la página
    seleccionado.stock = respuesta.data.stock_restante;
    inputCantidad.value = 1;
    dibujarProductos();
    actualizarSeleccion();
    const pedidosNuevos = await api(`/estancias/${estancia.id}/pedidos`);
    if (pedidosNuevos.success) dibujarPedidos(pedidosNuevos.data);
    refrescarVistaOperativa();
  });
}

// ============================================================
// SALIDA
// ============================================================
async function modalSalida(estanciaId) {
  const respuesta = await api(`/estancias/${estanciaId}/pre-salida`);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const d = respuesta.data;
  const hayPendiente = d.total_pendiente > 0;

  abrirModal({
    titulo: `Salida · ${escapar(d.habitacion_nombre)}${d.placa ? ` (${escapar(d.placa)})` : ''}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Entrada</span><strong>${formatoFechaHora(d.hora_entrada)}</strong></div>
        <div class="linea"><span>Salida prevista</span><strong>${formatoFechaHora(d.hora_salida_prevista)}</strong></div>
        <div class="linea"><span>Habitación (${escapar(d.tarifa_nombre) || (d.tipo === 'noche' ? 'noche' : d.horas_contratadas + ' h')})
          ${d.pagado_base ? '<span class="suave">· ya pagado</span>' : ''}</span>
          <span class="monto">${formatoQ(d.total_base)}</span></div>
        ${Number(d.cargo_extra) > 0 ? `
        <div class="linea"><span>Cargo de reserva${d.cargo_descripcion ? ` (${escapar(d.cargo_descripcion)})` : ''}
          ${d.pagado_base ? '<span class="suave">· ya pagado</span>' : ''}</span>
          <span class="monto">${formatoQ(d.cargo_extra)}</span></div>` : ''}
        ${d.horas_extra > 0 ? `
        <div class="linea excedido-linea"><span>Horas extra (${d.horas_extra} × ${formatoQ(d.precio_hora_extra)})</span>
          <span class="monto">${formatoQ(d.total_extra)}</span></div>` : ''}
        <div class="linea"><span>Pedidos</span><span class="monto">${formatoQ(d.total_pedidos)}</span></div>
        <div class="linea"><span>Total de la estancia</span><span class="monto">${formatoQ(d.total_final)}</span></div>
        <div class="linea grande"><span>Pendiente por cobrar</span><span class="monto">${formatoQ(d.total_pendiente)}</span></div>
      </div>
      ${hayPendiente ? `
      <div class="campo"><label>Método de pago</label>
        <div class="grupo-opciones" id="ms-metodo">
          <button type="button" class="opcion activa" data-valor="efectivo">${icono('dinero', 15)} Efectivo</button>
          <button type="button" class="opcion" data-valor="transferencia">${icono('banco', 15)} Transferencia</button>
        </div></div>
      <div class="campo" id="ms-campo-efectivo"><label>Efectivo recibido (Q)</label>
        <input id="ms-recibido" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
        <div class="cambio-grande oculto" id="ms-cambio"></div></div>`
      : '<p class="suave" style="font-size:13.5px">No hay nada pendiente por cobrar. La habitación pasará a limpieza.</p>'}`,
    pie: `<button class="boton secundario" id="ms-cancelar">Cancelar</button>
          <button class="boton peligro" id="ms-finalizar">Finalizar estancia</button>`
  });

  if (hayPendiente) {
    const inputRecibido = document.getElementById('ms-recibido');
    const cajaCambio = document.getElementById('ms-cambio');
    inputRecibido.addEventListener('input', () => {
      const recibido = Number(inputRecibido.value);
      if (recibido >= d.total_pendiente) {
        cajaCambio.textContent = 'Cambio: ' + formatoQ(recibido - d.total_pendiente);
        cajaCambio.classList.remove('oculto');
      } else {
        cajaCambio.classList.add('oculto');
      }
    });
    activarGrupoOpciones(document.getElementById('ms-metodo'), (valor) => {
      document.getElementById('ms-campo-efectivo').classList.toggle('oculto', valor !== 'efectivo');
    });
  }

  document.getElementById('ms-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('ms-finalizar').addEventListener('click', async () => {
    const cuerpo = {};
    if (hayPendiente) {
      cuerpo.metodo = opcionActiva(document.getElementById('ms-metodo'));
      if (cuerpo.metodo === 'efectivo') {
        cuerpo.efectivo_recibido = Number(document.getElementById('ms-recibido').value);
      }
    }
    const respuesta = await apiPost(`/estancias/${estanciaId}/salida`, cuerpo);
    if (!respuesta.success) return avisoRespuesta(respuesta);

    const r = respuesta.data;
    const cambioTexto = r.cambio !== null && r.cambio > 0 ? ` · Cambio: ${formatoQ(r.cambio)}` : '';
    aviso(`Estancia finalizada. Total ${formatoQ(r.total_final)}${cambioTexto}`);
    cerrarModal();
    refrescarVistaOperativa();
  });
}

// ============================================================
// SECCIÓN ESTANCIAS ACTIVAS
// ============================================================
async function cargarEstancias() {
  const respuesta = await api('/estancias/activas');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  App.deltaReloj = respuesta.data.ahora_epoch - Date.now();
  const estancias = respuesta.data.estancias;

  const seccion = document.getElementById('seccion-estancias');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Estancias activas</h2>
        <div class="sub">${estancias.length} habitación(es) ocupada(s)</div>
      </div>
    </div>
    ${estancias.length ? `
    <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
      <thead><tr>
        <th>Habitación</th><th>Placa</th><th>Servicio</th><th>Entrada</th>
        <th>Tiempo</th><th>Restante</th><th>Base</th><th class="derecha">Pedidos</th><th></th>
      </tr></thead>
      <tbody>${estancias.map((e) => `
        <tr>
          <td><strong>${escapar(e.habitacion_nombre)}</strong></td>
          <td>${escapar(e.placa) || '<span class="suave">—</span>'}</td>
          <td>${escapar(e.tarifa_nombre) || (e.tipo === 'noche' ? 'Noche' : e.horas_contratadas + ' h')}</td>
          <td>${formatoHora(e.hora_entrada)}</td>
          <td class="monto" data-tipo-contador="transcurrido" data-epoch="${e.entrada_epoch}"></td>
          <td class="monto ${e.excedida ? '' : ''}" data-tipo-contador="restante" data-epoch="${e.salida_prevista_epoch}"></td>
          <td>${e.pagado_base ? '<span class="etiqueta verde">Pagado</span>' : '<span class="etiqueta amarilla">Pendiente</span>'}</td>
          <td class="derecha monto">${formatoQ(e.total_pedidos)}</td>
          <td class="derecha" style="white-space:nowrap">
            <button class="boton secundario mini" data-pedido="${e.id}">Pedido</button>
            <button class="boton peligro mini" data-salida="${e.id}">Salida</button>
          </td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('carro', 26) + '</span>No hay estancias activas. Registre una entrada desde el tablero.</div>'}`;

  seccion.querySelectorAll('[data-pedido]').forEach((b) => {
    b.addEventListener('click', () => {
      const e = estancias.find((x) => x.id === Number(b.dataset.pedido));
      modalPedidos(e);
    });
  });
  seccion.querySelectorAll('[data-salida]').forEach((b) => {
    b.addEventListener('click', () => modalSalida(Number(b.dataset.salida)));
  });
  actualizarContadores();
}

// ============================================================
// LIMPIEZA
// ============================================================
function modalLimpieza(habitacion) {
  abrirModal({
    titulo: `Limpieza · ${escapar(habitacion.nombre)}`,
    cuerpo: `
      <p style="font-size:14.5px;line-height:1.5">
        La habitación lleva <strong>${formatoMinutos(habitacion.minutos_limpieza || 0)}</strong> en limpieza.<br>
        <span class="suave">¿Marcarla como limpia y disponible?</span></p>`,
    pie: `<button class="boton secundario" id="ml-cancelar">Cancelar</button>
          <button class="boton exito" id="ml-limpia">${icono('palomita', 15)} Marcar como limpia</button>`
  });
  document.getElementById('ml-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('ml-limpia').addEventListener('click', async () => {
    const respuesta = await apiPost(`/habitaciones/${habitacion.id}/limpia`);
    avisoRespuesta(respuesta);
    cerrarModal();
    refrescarVistaOperativa();
  });
}

async function cargarLimpieza() {
  const respuesta = await api('/limpieza');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const habitaciones = respuesta.data;

  const seccion = document.getElementById('seccion-limpieza');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Limpieza</h2>
        <div class="sub">${habitaciones.length} habitación(es) por limpiar</div>
      </div>
    </div>
    ${habitaciones.length ? `
    <div class="malla-habitaciones">${habitaciones.map((h) => `
      <div class="tarjeta-habitacion limpieza">
        <div class="cabecera-hab">
          <span class="nombre-hab">${escapar(h.nombre)}</span>
          ${h.alerta ? '<span class="etiqueta roja">¡Atrasada!</span>' : '<span class="insignia-estado">limpieza</span>'}
        </div>
        <div class="cuerpo-hab">
          <div class="detalle-hab">En limpieza desde hace</div>
          <div class="contador">${formatoMinutos(h.minutos)}</div>
          <button class="boton exito chico" style="margin-top:12px;width:100%" data-limpia="${h.id}">${icono('palomita', 14)} Marcar limpia</button>
        </div>
      </div>`).join('')}
    </div>`
    : '<div class="vacio"><span class="ico">' + icono('limpieza', 26) + '</span>No hay habitaciones en limpieza</div>'}`;

  seccion.querySelectorAll('[data-limpia]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const respuesta = await apiPost(`/habitaciones/${boton.dataset.limpia}/limpia`);
      avisoRespuesta(respuesta);
      await cargarLimpieza();
      refrescarAlertas();
    });
  });
}

// ============================================================
// RESERVAS
// ============================================================
function modalReservaHabitacion(habitacion) {
  abrirModal({
    titulo: `Reserva · ${escapar(habitacion.nombre)}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Fecha y hora</span>
          <strong>${habitacion.reserva_fecha_hora ? formatoFechaHora(habitacion.reserva_fecha_hora) : '—'}</strong></div>
        <div class="linea"><span>Placa</span><strong>${escapar(habitacion.reserva_placa) || '—'}</strong></div>
        ${habitacion.reserva_nota ? `<div class="linea"><span>Nota</span><strong>${escapar(habitacion.reserva_nota)}</strong></div>` : ''}
        ${Number(habitacion.reserva_cargo_extra) > 0 ? `
        <div class="linea"><span>Cargo adicional${habitacion.reserva_cargo_descripcion ? ` (${escapar(habitacion.reserva_cargo_descripcion)})` : ''}</span>
          <strong class="monto">${formatoQ(habitacion.reserva_cargo_extra)}</strong></div>` : ''}
      </div>`,
    pie: `<button class="boton peligro" id="mr-cancelar-reserva">Cancelar reserva</button>
          <button class="boton" id="mr-llego">${icono('carro', 15)} El cliente llegó</button>`
  });
  document.getElementById('mr-llego').addEventListener('click', () => {
    modalEntrada(habitacion, {
      id: habitacion.reserva_id,
      placa: habitacion.reserva_placa,
      cargo_extra: habitacion.reserva_cargo_extra,
      cargo_descripcion: habitacion.reserva_cargo_descripcion
    });
  });
  document.getElementById('mr-cancelar-reserva').addEventListener('click', async () => {
    const respuesta = await apiPost(`/reservas/${habitacion.reserva_id}/cancelar`);
    avisoRespuesta(respuesta);
    cerrarModal();
    refrescarVistaOperativa();
  });
}

async function cargarReservas() {
  const [reservasRespuesta, tableroRespuesta] = await Promise.all([
    api('/reservas'),
    api('/habitaciones')
  ]);
  if (!reservasRespuesta.success) return avisoRespuesta(reservasRespuesta);
  const { pendientes, historial } = reservasRespuesta.data;
  const disponibles = tableroRespuesta.success
    ? tableroRespuesta.data.habitaciones.filter((h) => h.estado === 'disponible')
    : [];

  const seccion = document.getElementById('seccion-reservas');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Reservas</h2>
        <div class="sub">${pendientes.length} reserva(s) pendiente(s)</div>
      </div>
      <button class="boton" id="nueva-reserva">${icono('mas', 15)} Crear reserva</button>
    </div>

    <div id="lista-reservas">
    ${pendientes.length ? `
      <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
        <thead><tr><th>Habitación</th><th>Fecha y hora</th><th>Placa</th><th>Nota</th><th class="derecha">Cargo extra</th><th>Creó</th><th></th></tr></thead>
        <tbody>${pendientes.map((r) => `
          <tr>
            <td><strong>${escapar(r.habitacion_nombre)}</strong></td>
            <td>${formatoFechaHora(r.fecha_hora)}</td>
            <td>${escapar(r.placa) || '—'}</td>
            <td class="suave">${escapar(r.nota) || '—'}</td>
            <td class="derecha monto">${Number(r.cargo_extra) > 0
              ? `<strong title="${escapar(r.cargo_descripcion)}">${formatoQ(r.cargo_extra)}</strong>`
              : '<span class="suave">—</span>'}</td>
            <td class="suave">${escapar(r.creado_por_nombre)}</td>
            <td class="derecha" style="white-space:nowrap">
              <button class="boton mini" data-convertir="${r.id}" data-habitacion="${r.habitacion_id}">Llegó</button>
              <button class="boton peligro mini" data-cancelar="${r.id}">Cancelar</button>
            </td>
          </tr>`).join('')}
        </tbody></table></div>`
      : '<div class="vacio"><span class="ico">' + icono('calendario', 26) + '</span>No hay reservas pendientes</div>'}
    </div>

    ${historial.length ? `
    <div class="panel">
      <h3>Últimas reservas resueltas</h3>
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Habitación</th><th>Fecha y hora</th><th>Placa</th><th>Estado</th></tr></thead>
        <tbody>${historial.map((r) => `
          <tr>
            <td>${escapar(r.habitacion_nombre)}</td>
            <td>${formatoFechaHora(r.fecha_hora)}</td>
            <td>${escapar(r.placa) || '—'}</td>
            <td>${r.estado === 'usada' ? '<span class="etiqueta verde">Usada</span>' : '<span class="etiqueta gris">Cancelada</span>'}</td>
          </tr>`).join('')}
        </tbody></table></div>
    </div>` : ''}`;

  document.getElementById('nueva-reserva').addEventListener('click', () => modalCrearReserva(disponibles));

  seccion.querySelectorAll('[data-convertir]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const reserva = pendientes.find((r) => r.id === Number(boton.dataset.convertir));
      const habitacion = (tableroRespuesta.data.habitaciones || []).find((h) => h.id === Number(boton.dataset.habitacion));
      if (habitacion) modalEntrada(habitacion, reserva);
    });
  });
  seccion.querySelectorAll('[data-cancelar]').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const respuesta = await apiPost(`/reservas/${boton.dataset.cancelar}/cancelar`);
      avisoRespuesta(respuesta);
      await cargarReservas();
      refrescarAlertas();
    });
  });
}

function modalCrearReserva(habitacionesDisponibles) {
  if (!habitacionesDisponibles.length) {
    return aviso('No hay habitaciones disponibles para reservar', true);
  }
  abrirModal({
    titulo: 'Crear reserva',
    cuerpo: `
      <div class="campo"><label>Habitación</label>
        <select id="mcr-habitacion">
          ${habitacionesDisponibles.map((h) => `<option value="${h.id}">${escapar(h.nombre)}</option>`).join('')}
        </select></div>
      <div class="campo"><label>Fecha y hora de llegada</label>
        <input id="mcr-fecha" type="datetime-local"></div>
      <div class="campo"><label>Placa (opcional)</label>
        <input id="mcr-placa" maxlength="20" autocapitalize="characters"></div>
      <div class="campo"><label>Nota (opcional)</label>
        <input id="mcr-nota" maxlength="200"></div>
      <div class="fila-campos">
        <div class="campo"><label>Cargo adicional (Q)</label>
          <input id="mcr-cargo" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00">
          <div class="ayuda">Recargo por reservar y/o extras solicitados</div></div>
        <div class="campo"><label>Detalle del cargo (opcional)</label>
          <input id="mcr-cargo-detalle" maxlength="200" placeholder="Ej.: decoración, pétalos, globos"></div>
      </div>
      <div class="ayuda suave">La habitación quedará en morado (reservada) hasta que el cliente llegue o se cancele.
        El cargo adicional se cobrará junto con la tarifa al registrar la entrada.</div>`,
    pie: `<button class="boton secundario" id="mcr-cancelar">Cancelar</button>
          <button class="boton" id="mcr-crear">Crear reserva</button>`
  });

  document.getElementById('mcr-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mcr-crear').addEventListener('click', async () => {
    const fechaCruda = valorModal('#mcr-fecha'); // '2026-07-12T21:00'
    const respuesta = await apiPost('/reservas', {
      habitacion_id: Number(valorModal('#mcr-habitacion')),
      fecha_hora: fechaCruda.replace('T', ' '),
      placa: valorModal('#mcr-placa').toUpperCase(),
      nota: valorModal('#mcr-nota'),
      cargo_extra: valorModal('#mcr-cargo') === '' ? 0 : Number(valorModal('#mcr-cargo')),
      cargo_descripcion: valorModal('#mcr-cargo-detalle')
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso('Reserva creada en ' + respuesta.data.habitacion_nombre);
    cerrarModal();
    await cargarReservas();
    refrescarAlertas();
  });
}

// ============================================================
// Refresco de la vista tras una operación
// ============================================================
async function refrescarVistaOperativa() {
  refrescarAlertas();
  if (App.seccion === 'tablero') await cargarTablero();
  else if (App.seccion === 'estancias') await cargarEstancias();
  else if (App.seccion === 'limpieza') await cargarLimpieza();
  else if (App.seccion === 'reservas') await cargarReservas();
  else if (App.seccion === 'dashboard') await cargarDashboard();
}
