// ============================================================
// Control de caja (frontend).
// - Trabajador: al entrar sin caja abierta, un modal exige el fondo
//   de caja (bloquea operaciones salvo limpieza). Botón "Caja" en la
//   barra superior para ver el turno y cerrarlo (arqueo + salida).
// - Dueño: sección "Cajas" con el historial para auditar descuadres.
// Los montos que deciden el arqueo los calcula el backend.
// ============================================================

/** Refresca el estado de la caja del hotel y el botón de la barra. */
async function cargarEstadoCaja() {
  if (App.esDueno) return; // el dueño audita en la sección Cajas, no opera caja
  const respuesta = await api('/caja/estado');
  if (!respuesta.success) return;
  App.caja = respuesta.data.abierta; // objeto si hay caja abierta, o null
  actualizarBotonCaja();
}

/** Muestra/oculta y etiqueta el botón de caja de la barra (trabajador). */
function actualizarBotonCaja() {
  const boton = document.getElementById('boton-caja');
  if (!boton || App.esDueno) return;
  boton.classList.remove('oculto');
  const etiqueta = document.getElementById('etiqueta-caja');
  if (App.caja) {
    boton.classList.remove('peligro');
    if (etiqueta) etiqueta.textContent = 'Caja: ' + formatoQ(App.caja.efectivo_esperado);
  } else {
    boton.classList.add('peligro');
    if (etiqueta) etiqueta.textContent = 'Abrir caja';
  }
}

/**
 * Guarda de operaciones: el trabajador necesita caja abierta para
 * todo lo que no sea limpieza. Devuelve true si puede continuar.
 */
function requiereCaja() {
  if (App.esDueno || App.caja) return true;
  aviso('Abra su caja para operar (solo la limpieza está disponible sin caja)', true);
  modalAbrirCaja();
  return false;
}

/** Modal para abrir la caja con el fondo inicial ("sencillo"). */
function modalAbrirCaja() {
  if (document.querySelector('.fondo-modal .modal .abrir-caja')) return; // ya abierto
  abrirModal({
    titulo: 'Abra su caja para comenzar',
    cuerpo: `
      <div class="abrir-caja">
        <p style="font-size:14px;line-height:1.55;margin-bottom:14px">
          Antes de cobrar necesita abrir su caja con el <strong>fondo inicial</strong>
          (el "sencillo" con el que empieza el turno).
          <span class="suave">Sin caja abierta solo puede realizar limpieza.</span>
        </p>
        <div class="campo"><label>Fondo de caja (Q)</label>
          <input id="mac-monto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
          <div class="ayuda">Efectivo físico con el que arranca. Si empieza sin sencillo, deje 0.</div></div>
      </div>`,
    pie: `<button class="boton secundario" id="mac-limpieza">Ir a limpieza</button>
          <button class="boton" id="mac-abrir">Abrir caja</button>`
  });

  document.getElementById('mac-limpieza').addEventListener('click', () => {
    cerrarModal();
    mostrarSeccion('limpieza');
  });
  document.getElementById('mac-abrir').addEventListener('click', async () => {
    const monto = valorModal('#mac-monto');
    const respuesta = await apiPost('/caja/abrir', { monto_inicial: monto === '' ? 0 : Number(monto) });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso('Caja abierta con fondo de ' + formatoQ(respuesta.data.monto_inicial));
    cerrarModal();
    await cargarEstadoCaja();
    refrescarVistaOperativa();
  });
}

/** Modal con el estado del turno y acceso al cierre. */
async function modalCaja() {
  if (!App.caja) return modalAbrirCaja();
  const respuesta = await api('/caja/estado');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  if (!respuesta.data.abierta) { // se cerró en otra pestaña
    App.caja = null;
    actualizarBotonCaja();
    return modalAbrirCaja();
  }
  const c = respuesta.data.abierta;
  App.caja = c;
  actualizarBotonCaja();

  abrirModal({
    titulo: 'Mi caja (turno abierto)',
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Abrió</span><strong>${escapar(c.usuario_nombre)}</strong></div>
        <div class="linea"><span>Apertura</span><strong>${formatoFechaHora(c.fecha_apertura)}</strong></div>
        <div class="linea"><span>Fondo inicial</span><span class="monto">${formatoQ(c.monto_inicial)}</span></div>
        <div class="linea"><span>Efectivo cobrado en el turno</span><span class="monto">${formatoQ(c.efectivo_cobrado)}</span></div>
        <div class="linea grande"><span>Efectivo que debe haber en caja</span>
          <span class="monto">${formatoQ(c.efectivo_esperado)}</span></div>
      </div>
      <div class="ayuda suave">Los cobros por transferencia no cuentan para el efectivo de la caja.</div>`,
    pie: `<button class="boton secundario" id="mcj-cerrar">Cerrar</button>
          <button class="boton peligro" id="mcj-turno">Cerrar turno / caja</button>`
  });
  document.getElementById('mcj-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('mcj-turno').addEventListener('click', () => modalCerrarCaja(c));
}

/** Modal de arqueo: declarar efectivo físico, ver descuadre y cerrar. */
function modalCerrarCaja(caja) {
  abrirModal({
    titulo: 'Cerrar turno · arqueo de caja',
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Efectivo esperado (sistema)</span>
          <span class="monto">${formatoQ(caja.efectivo_esperado)}</span></div>
      </div>
      <div class="campo"><label>Efectivo físico contado (Q)</label>
        <input id="mcc-declarado" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
        <div class="ayuda">Cuente el efectivo real que tiene en caja e ingréselo aquí.</div></div>
      <div id="mcc-descuadre" class="cambio-grande oculto"></div>
      <div class="ayuda suave">Al cerrar el turno se guardará el arqueo y se cerrará su sesión.</div>`,
    pie: `<button class="boton secundario" id="mcc-cancelar">Cancelar</button>
          <button class="boton peligro" id="mcc-confirmar">Cerrar turno y salir</button>`
  });

  const inputDeclarado = document.getElementById('mcc-declarado');
  const cajaDescuadre = document.getElementById('mcc-descuadre');
  const esperado = Number(caja.efectivo_esperado);

  const previsualizar = () => {
    if (inputDeclarado.value === '') { cajaDescuadre.classList.add('oculto'); return; }
    const declarado = Number(inputDeclarado.value) || 0;
    const descuadre = Math.round((declarado - esperado) * 100) / 100;
    cajaDescuadre.classList.remove('oculto');
    if (descuadre === 0) {
      cajaDescuadre.style.color = 'var(--verde)';
      cajaDescuadre.textContent = 'La caja cuadra exactamente';
    } else if (descuadre > 0) {
      cajaDescuadre.style.color = 'var(--amarillo)';
      cajaDescuadre.textContent = 'Sobrante: ' + formatoQ(descuadre);
    } else {
      cajaDescuadre.style.color = 'var(--rojo)';
      cajaDescuadre.textContent = 'Faltante: ' + formatoQ(-descuadre);
    }
  };
  inputDeclarado.addEventListener('input', previsualizar);

  document.getElementById('mcc-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mcc-confirmar').addEventListener('click', async () => {
    if (inputDeclarado.value === '') return aviso('Ingrese el efectivo contado', true);
    const respuesta = await apiPost('/caja/cerrar', { monto_declarado: Number(inputDeclarado.value) });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    const d = respuesta.data;
    const resumen = d.descuadre === 0
      ? 'Caja cuadrada'
      : (d.descuadre > 0 ? 'Sobrante ' + formatoQ(d.descuadre) : 'Faltante ' + formatoQ(-d.descuadre));
    aviso('Turno cerrado. ' + resumen);
    App.caja = null;
    cerrarModal();
    // Cierra sesión tras el arqueo, como pide el flujo de turno.
    setTimeout(async () => {
      await apiPost('/auth/logout');
      window.location.href = '/';
    }, 1200);
  });
}

// ============================================================
// Dueño: historial de cajas (auditoría de descuadres)
// ============================================================
function etiquetaDescuadre(caja) {
  if (caja.estado === 'abierta') return '<span class="etiqueta azul">En curso</span>';
  const d = Number(caja.descuadre);
  if (d === 0) return '<span class="etiqueta verde">Cuadra</span>';
  if (d > 0) return `<span class="etiqueta amarilla">Sobrante ${formatoQ(d)}</span>`;
  return `<span class="etiqueta roja">Faltante ${formatoQ(-d)}</span>`;
}

async function cargarCajas() {
  const respuesta = await api('/caja/historial');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const cajas = respuesta.data;

  const seccion = document.getElementById('seccion-caja');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Control de cajas</h2>
        <div class="sub">Turnos de sus trabajadores y descuadres de efectivo</div>
      </div>
    </div>
    ${cajas.length ? `
    <div class="envoltura-tabla panel" style="padding:6px 12px"><table class="tabla">
      <thead><tr>
        <th>Trabajador</th><th>Apertura</th><th>Cierre</th>
        <th class="derecha">Fondo</th><th class="derecha">Esperado</th>
        <th class="derecha">Declarado</th><th>Arqueo</th>
      </tr></thead>
      <tbody>${cajas.map((c) => `
        <tr>
          <td><strong>${escapar(c.usuario_nombre)}</strong></td>
          <td style="white-space:nowrap">${formatoFechaHora(c.fecha_apertura)}</td>
          <td style="white-space:nowrap">${c.fecha_cierre ? formatoFechaHora(c.fecha_cierre) : '<span class="suave">—</span>'}</td>
          <td class="derecha monto">${formatoQ(c.monto_inicial)}</td>
          <td class="derecha monto">${c.monto_sistema !== null ? formatoQ(c.monto_sistema) : '—'}</td>
          <td class="derecha monto">${c.monto_declarado !== null ? formatoQ(c.monto_declarado) : '<span class="suave">—</span>'}</td>
          <td>${etiquetaDescuadre(c)}</td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('caja', 26) + '</span>Aún no hay turnos de caja registrados</div>'}`;
}
