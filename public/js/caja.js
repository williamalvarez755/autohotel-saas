// ============================================================
// Control de caja (frontend).
// - Trabajador: al entrar sin caja abierta, un modal exige el fondo
//   de caja (bloquea operaciones salvo limpieza). Botón "Caja" en la
//   barra superior para ver el turno y cerrarlo (arqueo + salida).
// - Dueño: sección "Cajas" con el historial para auditar descuadres.
// Los montos que deciden el arqueo los calcula el backend.
// ============================================================

/**
 * Refresca el estado de la caja del hotel y el botón de la barra.
 * Dueño Y trabajador operan la caja (abrir, retirar, cerrar); solo
 * el bloqueo de operaciones sin caja aplica al trabajador.
 */
async function cargarEstadoCaja() {
  const respuesta = await api('/caja/estado');
  if (!respuesta.success) return;
  App.caja = respuesta.data.abierta; // objeto si hay caja abierta, o null
  actualizarBotonCaja();
}

/** Muestra y etiqueta el botón de caja de la barra. */
function actualizarBotonCaja() {
  const boton = document.getElementById('boton-caja');
  if (!boton) return;
  boton.classList.remove('oculto');
  const etiqueta = document.getElementById('etiqueta-caja');
  if (App.caja) {
    boton.classList.remove('peligro');
    if (etiqueta) etiqueta.textContent = 'Caja: ' + formatoQ(App.caja.efectivo_esperado);
  } else {
    // Al trabajador se le exige abrirla; para el dueño es opcional
    boton.classList.toggle('peligro', !App.esDueno);
    if (etiqueta) etiqueta.textContent = 'Abrir caja';
  }
}

/** Fecha de hoy como DD-MM-YYYY (para previsualizar notas). */
function fechaNotaHoy() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
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
    titulo: App.esDueno ? 'Abrir caja del hotel' : 'Abra su caja para comenzar',
    cuerpo: `
      <div class="abrir-caja">
        <p style="font-size:14px;line-height:1.55;margin-bottom:14px">
          ${App.esDueno
            ? 'Abra la caja del turno con el <strong>fondo inicial</strong> ("sencillo"). Con la caja abierta podrá registrar retiros y gastos con su nota automática.'
            : 'Antes de cobrar necesita abrir su caja con el <strong>fondo inicial</strong> (el "sencillo" con el que empieza el turno). <span class="suave">Sin caja abierta solo puede realizar limpieza.</span>'}
        </p>
        <div class="campo"><label>Fondo de caja (Q)</label>
          <input id="mac-monto" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
          <div class="ayuda">Efectivo físico con el que arranca. Si empieza sin sencillo, deje 0.</div></div>
      </div>`,
    pie: `<button class="boton secundario" id="mac-limpieza">${App.esDueno ? 'Cancelar' : 'Ir a limpieza'}</button>
          <button class="boton" id="mac-abrir">Abrir caja</button>`
  });

  document.getElementById('mac-limpieza').addEventListener('click', () => {
    cerrarModal();
    if (!App.esDueno) mostrarSeccion('limpieza');
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

  const notasHtml = (c.retiros || []).slice(0, 6).map((r) => `
    <div class="linea"><span class="suave" style="font-size:12.5px">${escapar(r.nota)}
      <span style="opacity:.7">· ${escapar(r.usuario_nombre)}</span></span>
      <span class="monto">− ${formatoQ(r.monto)}</span></div>`).join('');

  abrirModal({
    titulo: 'Caja (turno abierto)',
    ancho: true,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Abrió</span><strong>${escapar(c.usuario_nombre)}</strong></div>
        <div class="linea"><span>Apertura</span><strong>${formatoFechaHora(c.fecha_apertura)}</strong></div>
        <div class="linea"><span>Fondo inicial</span><span class="monto">${formatoQ(c.monto_inicial)}</span></div>
        <div class="linea"><span>+ Ventas en efectivo del turno</span><span class="monto">${formatoQ(c.efectivo_cobrado)}</span></div>
        <div class="linea"><span>− Retiros y gastos</span><span class="monto">${formatoQ(c.total_retiros)}</span></div>
        <div class="linea grande"><span>Efectivo que debe haber en caja</span>
          <span class="monto">${formatoQ(c.efectivo_esperado)}</span></div>
      </div>
      ${notasHtml ? `
      <div class="campo"><label>Notas de retiros del turno</label>
        <div class="desglose">${notasHtml}</div></div>` : ''}
      <div class="ayuda suave">Los cobros por transferencia no cuentan para el efectivo de la caja.</div>`,
    pie: `<button class="boton secundario" id="mcj-cerrar">Cerrar</button>
          <button class="boton secundario" id="mcj-retiro">${icono('dinero', 15)} Retiro / gasto</button>
          <button class="boton peligro" id="mcj-turno">Cerrar turno / caja</button>`
  });
  document.getElementById('mcj-cerrar').addEventListener('click', cerrarModal);
  document.getElementById('mcj-retiro').addEventListener('click', () => modalRetiro(c));
  document.getElementById('mcj-turno').addEventListener('click', () => modalCerrarCaja(c));
}

/**
 * Retiro de efectivo (gasto operativo o retiro del dueño): exige
 * monto y justificación, y muestra en vivo la nota que se generará.
 */
function modalRetiro(caja) {
  abrirModal({
    titulo: 'Retiro de efectivo / gasto',
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Efectivo disponible en caja</span>
          <span class="monto">${formatoQ(caja.efectivo_esperado)}</span></div>
      </div>
      <div class="campo"><label>Monto a retirar (Q)</label>
        <input id="mr-monto" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0.00" autofocus></div>
      <div class="campo"><label>Justificación (obligatoria)</label>
        <input id="mr-justificacion" maxlength="200" placeholder="Ej.: desayuno trabajadores, compra de insumos"></div>
      <div class="campo"><label>Nota que se guardará</label>
        <div class="desglose"><div class="linea"><span class="suave" id="mr-nota">—</span></div></div></div>`,
    pie: `<button class="boton secundario" id="mr-cancelar">Cancelar</button>
          <button class="boton" id="mr-confirmar">Registrar retiro</button>`
  });

  const inputMonto = document.getElementById('mr-monto');
  const inputJust = document.getElementById('mr-justificacion');
  const vistaNota = document.getElementById('mr-nota');
  const previsualizar = () => {
    const m = Number(inputMonto.value);
    const j = inputJust.value.trim();
    if (!m || m <= 0 || !j) { vistaNota.textContent = '—'; return; }
    const montoTexto = Number.isInteger(m) ? String(m) : m.toFixed(2);
    vistaNota.textContent = `${fechaNotaHoy()} se retira ${montoTexto} para ${j}`;
  };
  inputMonto.addEventListener('input', previsualizar);
  inputJust.addEventListener('input', previsualizar);

  document.getElementById('mr-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mr-confirmar').addEventListener('click', async () => {
    const monto = Number(inputMonto.value);
    if (!monto || monto <= 0) return aviso('Ingrese el monto a retirar', true);
    if (!inputJust.value.trim()) return aviso('La justificación es obligatoria', true);
    const respuesta = await apiPost('/caja/retiros', { monto, justificacion: inputJust.value.trim() });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso('Nota guardada: ' + respuesta.data.nota);
    cerrarModal();
    await cargarEstadoCaja();
    modalCaja(); // vuelve al detalle de la caja con el nuevo saldo
  });
}

/** Modal de arqueo: declarar efectivo físico, ver descuadre y cerrar. */
function modalCerrarCaja(caja) {
  abrirModal({
    titulo: 'Cerrar turno · arqueo de caja',
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Fondo inicial</span><span class="monto">${formatoQ(caja.monto_inicial)}</span></div>
        <div class="linea"><span>+ Ventas en efectivo</span><span class="monto">${formatoQ(caja.efectivo_cobrado)}</span></div>
        <div class="linea"><span>− Retiros y gastos</span><span class="monto">${formatoQ(caja.total_retiros)}</span></div>
        <div class="linea grande"><span>Efectivo esperado (sistema)</span>
          <span class="monto">${formatoQ(caja.efectivo_esperado)}</span></div>
      </div>
      <div class="campo"><label>Efectivo físico contado (Q)</label>
        <input id="mcc-declarado" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00" autofocus>
        <div class="ayuda">Cuente el efectivo real que tiene en caja e ingréselo aquí.</div></div>
      <div id="mcc-descuadre" class="cambio-grande oculto"></div>
      <label class="fila-flex" style="gap:8px;font-size:13.5px;margin:10px 0 4px">
        <input type="checkbox" id="mcc-retirar" checked>
        Retirar el efectivo y generar la nota "se retira efectivo del hotel"
      </label>
      <div class="ayuda suave">${App.esDueno
        ? 'Al cerrar se guardará el arqueo del turno.'
        : 'Al cerrar el turno se guardará el arqueo y se cerrará su sesión.'}</div>`,
    pie: `<button class="boton secundario" id="mcc-cancelar">Cancelar</button>
          <button class="boton peligro" id="mcc-confirmar">${App.esDueno ? 'Cerrar turno' : 'Cerrar turno y salir'}</button>`
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
    const respuesta = await apiPost('/caja/cerrar', {
      monto_declarado: Number(inputDeclarado.value),
      retirar_efectivo: document.getElementById('mcc-retirar').checked
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    const d = respuesta.data;
    const resumen = d.descuadre === 0
      ? 'Caja cuadrada'
      : (d.descuadre > 0 ? 'Sobrante ' + formatoQ(d.descuadre) : 'Faltante ' + formatoQ(-d.descuadre));
    aviso('Turno cerrado. ' + resumen + (d.nota_cierre ? ' · ' + d.nota_cierre : ''));
    App.caja = null;
    cerrarModal();
    if (App.esDueno) {
      // El dueño sigue trabajando: solo refresca su vista
      actualizarBotonCaja();
      refrescarVistaOperativa();
      return;
    }
    // El trabajador termina su turno: se cierra su sesión.
    setTimeout(async () => {
      await apiPost('/auth/logout');
      window.location.href = '/';
    }, 1600);
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
        <th>Abrió</th><th>Apertura</th><th>Cierre</th>
        <th class="derecha">Fondo</th><th class="derecha">Retiros</th>
        <th class="derecha">Esperado</th><th class="derecha">Declarado</th><th>Arqueo</th><th></th>
      </tr></thead>
      <tbody>${cajas.map((c) => `
        <tr>
          <td><strong>${escapar(c.usuario_nombre)}</strong></td>
          <td style="white-space:nowrap">${formatoFechaHora(c.fecha_apertura)}</td>
          <td style="white-space:nowrap">${c.fecha_cierre ? formatoFechaHora(c.fecha_cierre) : '<span class="suave">—</span>'}</td>
          <td class="derecha monto">${formatoQ(c.monto_inicial)}</td>
          <td class="derecha monto">${Number(c.total_retiros) > 0 ? '− ' + formatoQ(c.total_retiros) : '<span class="suave">—</span>'}</td>
          <td class="derecha monto">${c.monto_sistema !== null ? formatoQ(c.monto_sistema) : '—'}</td>
          <td class="derecha monto">${c.monto_declarado !== null ? formatoQ(c.monto_declarado) : '<span class="suave">—</span>'}</td>
          <td>${etiquetaDescuadre(c)}</td>
          <td class="derecha">${Number(c.notas) > 0
            ? `<button class="boton secundario mini" data-notas="${c.id}">${icono('documento', 12)} Notas (${c.notas})</button>`
            : ''}</td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio"><span class="ico">' + icono('caja', 26) + '</span>Aún no hay turnos de caja registrados</div>'}`;

  seccion.querySelectorAll('[data-notas]').forEach((boton) => {
    boton.addEventListener('click', () => modalNotasTurno(Number(boton.dataset.notas)));
  });
}

/** Notas/retiros de un turno del historial (auditoría del dueño). */
async function modalNotasTurno(turnoId) {
  const respuesta = await api(`/caja/${turnoId}/retiros`);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const retiros = respuesta.data;
  abrirModal({
    titulo: `Notas de retiros · turno #${turnoId}`,
    ancho: true,
    cuerpo: retiros.length ? `
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Nota</th><th>Tipo</th><th class="derecha">Monto</th><th>Hizo</th><th>Fecha</th></tr></thead>
        <tbody>${retiros.map((r) => `
          <tr>
            <td>${escapar(r.nota)}</td>
            <td>${r.tipo === 'cierre'
              ? '<span class="etiqueta azul">Cierre</span>'
              : '<span class="etiqueta amarilla">Gasto</span>'}</td>
            <td class="derecha monto">${formatoQ(r.monto)}</td>
            <td class="suave">${escapar(r.usuario_nombre)}</td>
            <td class="suave" style="white-space:nowrap">${formatoFechaHora(r.fecha)}</td>
          </tr>`).join('')}
        </tbody></table></div>`
      : '<div class="vacio"><span class="ico">' + icono('documento', 24) + '</span>Este turno no tiene retiros</div>',
    pie: '<button class="boton secundario" id="mnt-cerrar">Cerrar</button>'
  });
  document.getElementById('mnt-cerrar').addEventListener('click', cerrarModal);
}
