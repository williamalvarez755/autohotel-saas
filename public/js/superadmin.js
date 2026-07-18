// ============================================================
// Panel del superadmin (proveedor). Multi-módulo:
//   - Propietarios: dueños con ficha completa, hoteles, pagos.
//   - Consultas avanzadas  (superadmin-consultas.js)
//   - Limpieza de datos    (superadmin-limpieza.js)
//   - Políticas de retención (superadmin-limpieza.js)
// Todas las rutas exigen rol superadmin en el backend.
// ============================================================

const SuperApp = { sesion: null, seccion: null };
let duenos = [];
let criterioDuenos = '';

const MODULOS = [
  { id: 'propietarios', icono: 'usuarios',  texto: 'Propietarios' },
  { id: 'consultas',    icono: 'lupa',       texto: 'Consultas' },
  { id: 'limpieza',     icono: 'basura',     texto: 'Limpieza de datos' },
  { id: 'retencion',    icono: 'reloj',      texto: 'Retención' }
];

const CARGADORES_SA = {
  propietarios: cargarDuenos,
  consultas: () => cargarConsultas(),
  limpieza: () => cargarLimpieza(),
  retencion: () => cargarRetencion()
};

// ---------------- Arranque ----------------
(async function iniciar() {
  const sesion = await api('/auth/sesion');
  if (!sesion.success) return; // api.js redirige al login
  if (sesion.data.rol !== 'superadmin') {
    window.location.href = sesion.data.redirect;
    return;
  }
  SuperApp.sesion = sesion.data;
  document.getElementById('nombre-usuario').textContent = sesion.data.nombre;
  const avatar = document.getElementById('avatar-usuario');
  if (avatar) {
    const p = String(sesion.data.nombre || '').trim().split(/\s+/);
    avatar.textContent = (p[0] ? p[0][0] : '') + (p[1] ? p[1][0] : '');
  }

  document.getElementById('boton-salir').addEventListener('click', async () => {
    await apiPost('/auth/logout');
    window.location.href = '/';
  });
  document.getElementById('boton-password').addEventListener('click', modalCambiarPassword);

  construirNavegacionSA();
  mostrarSeccionSA('propietarios');
})();

function construirNavegacionSA() {
  const nav = document.getElementById('navegacion');
  nav.innerHTML = `<div class="grupo-nav">Proveedor</div>` + MODULOS.map((m) =>
    `<button class="enlace-nav" data-seccion="${m.id}">
       <span class="ico">${icono(m.icono, 18)}</span><span>${m.texto}</span>
     </button>`).join('');
  nav.querySelectorAll('[data-seccion]').forEach((boton) => {
    boton.addEventListener('click', () => mostrarSeccionSA(boton.dataset.seccion));
  });
}

function mostrarSeccionSA(id) {
  SuperApp.seccion = id;
  document.querySelectorAll('main section').forEach((s) => s.classList.add('oculto'));
  document.getElementById('seccion-' + id).classList.remove('oculto');
  document.querySelectorAll('.enlace-nav').forEach((b) =>
    b.classList.toggle('activo', b.dataset.seccion === id));
  CARGADORES_SA[id]();
}

// ============================================================
// MÓDULO PROPIETARIOS
// ============================================================
function etiquetaEstado(estado) {
  const mapa = {
    activa: ['verde', 'Activa'], por_vencer: ['amarilla', 'Por vencer'],
    vencida: ['roja', 'Vencida'], suspendida: ['gris', 'Suspendida']
  };
  const [clase, texto] = mapa[estado] || ['gris', estado];
  return `<span class="etiqueta ${clase}">${texto}</span>`;
}

async function cargarDuenos() {
  const respuesta = await api('/superadmin/duenos');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  duenos = respuesta.data;

  const seccion = document.getElementById('seccion-propietarios');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Propietarios</h2>
        <div class="sub">Dueños, sus hoteles, ficha de contacto y suscripción</div>
      </div>
      <button class="boton" id="boton-nuevo-dueno">${icono('mas', 15)} Nuevo propietario</button>
    </div>
    <div class="buscador-pos">
      <span class="lupa">${icono('lupa', 16)}</span>
      <input id="buscar-duenos" type="search" placeholder="Buscar por nombre, usuario, correo, teléfono, DPI o NIT…"
             autocomplete="off" spellcheck="false" value="${escapar(criterioDuenos)}">
    </div>
    <div id="lista-duenos"></div>`;

  document.getElementById('boton-nuevo-dueno').addEventListener('click', () => modalDueno(null));
  const buscador = document.getElementById('buscar-duenos');
  buscador.addEventListener('input', () => { criterioDuenos = buscador.value; dibujarDuenos(); });
  dibujarDuenos();
}

function duenosFiltrados() {
  if (!criterioDuenos.trim()) return duenos;
  const q = normalizarBusqueda(criterioDuenos);
  return duenos.filter((d) => normalizarBusqueda(
    [d.nombre, d.usuario, d.correo, d.telefono, d.dpi, d.nit].join(' ')).includes(q));
}

function dibujarDuenos() {
  const contenedor = document.getElementById('lista-duenos');
  const lista = duenosFiltrados();
  if (!duenos.length) {
    contenedor.innerHTML = `<div class="vacio"><span class="ico">${icono('usuarios', 26)}</span>Aún no hay propietarios registrados</div>`;
    return;
  }
  if (!lista.length) {
    contenedor.innerHTML = `<div class="vacio"><span class="ico">${icono('lupa', 26)}</span>Ningún propietario coincide con la búsqueda</div>`;
    return;
  }

  contenedor.innerHTML = lista.map((d) => `
    <div class="panel" data-dueno="${d.id}">
      <div class="fila-flex" style="justify-content:space-between">
        <div>
          <div class="fila-flex" style="gap:10px">
            <strong style="font-size:16px">${escapar(d.nombre)}</strong>
            ${etiquetaEstado(d.estado_calculado)}
            ${d.activo ? '' : '<span class="etiqueta gris">Inactivo</span>'}
          </div>
          <div class="suave" style="font-size:13px;margin-top:4px">
            Usuario: <strong>${escapar(d.usuario)}</strong> ·
            ${escapar(d.correo) || 'sin correo'} · ${escapar(d.telefono) || 'sin teléfono'} ·
            Administra <strong>${d.hoteles.length}</strong> hotel(es) ·
            Vence: <strong>${formatoFecha(d.fecha_vencimiento)}</strong>
          </div>
        </div>
        <div class="fila-flex">
          <button class="boton secundario chico" data-accion="ver">${icono('ojo', 14)} Ver</button>
          <button class="boton chico" data-accion="pago">${icono('dinero', 14)} Pago</button>
          ${d.estado_calculado === 'suspendida'
            ? '<button class="boton exito chico" data-accion="reactivar">Reactivar</button>'
            : '<button class="boton peligro chico" data-accion="suspender">Suspender</button>'}
          <button class="boton secundario chico" data-accion="editar">Editar</button>
          <button class="boton secundario chico" data-accion="historial">Historial</button>
          <button class="boton peligro chico" data-accion="eliminar" title="Eliminar definitivamente">${icono('basura', 13)}</button>
        </div>
      </div>
      <div style="margin-top:14px">
        <div class="fila-flex" style="justify-content:space-between;margin-bottom:8px">
          <span class="suave" style="font-size:12.5px;text-transform:uppercase;letter-spacing:.6px">Hoteles (${d.hoteles.length})</span>
          <button class="boton secundario mini" data-accion="nuevo-hotel">${icono('mas', 13)} Agregar hotel</button>
        </div>
        ${d.hoteles.length ? `
        <div class="envoltura-tabla"><table class="tabla">
          <thead><tr><th>Hotel</th><th>Dirección</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            ${d.hoteles.map((h) => `
              <tr>
                <td><strong>${escapar(h.nombre)}</strong></td>
                <td class="suave">${escapar(h.direccion) || '—'}</td>
                <td>${h.activo ? '<span class="etiqueta verde">Activo</span>' : '<span class="etiqueta gris">Inactivo</span>'}</td>
                <td class="derecha" style="white-space:nowrap">
                  <button class="boton secundario mini" data-accion="editar-hotel" data-hotel="${h.id}">Editar</button>
                  <button class="boton peligro mini" data-accion="eliminar-hotel" data-hotel="${h.id}">${icono('basura', 12)}</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>` : '<div class="suave" style="font-size:13px">Sin hoteles asignados</div>'}
      </div>
    </div>`).join('');

  contenedor.querySelectorAll('[data-accion]').forEach((boton) => {
    boton.addEventListener('click', () => {
      const idDueno = Number(boton.closest('[data-dueno]').dataset.dueno);
      const dueno = duenos.find((x) => x.id === idDueno);
      const accion = boton.dataset.accion;
      if (accion === 'ver') modalVerPropietario(dueno);
      if (accion === 'pago') modalPago(dueno);
      if (accion === 'suspender') suspenderDueno(dueno, true);
      if (accion === 'reactivar') suspenderDueno(dueno, false);
      if (accion === 'eliminar') modalEliminarDueno(dueno);
      if (accion === 'editar') modalDueno(dueno);
      if (accion === 'historial') modalHistorial(dueno);
      if (accion === 'nuevo-hotel') modalHotel(dueno, null);
      if (accion === 'editar-hotel' || accion === 'eliminar-hotel') {
        const hotel = dueno.hoteles.find((h) => h.id === Number(boton.dataset.hotel));
        if (accion === 'editar-hotel') modalHotel(dueno, hotel);
        else modalEliminarHotel(dueno, hotel);
      }
    });
  });
}

/** Vista de solo lectura con toda la ficha del propietario. */
function modalVerPropietario(d) {
  const dato = (et, vl) => `<div class="dato"><div class="et">${et}</div><div class="vl">${escapar(vl) || '—'}</div></div>`;
  abrirModal({
    titulo: `Ficha · ${escapar(d.nombre)}`,
    ancho: true,
    cuerpo: `
      <div class="ficha-datos">
        ${dato('Nombre completo', d.nombre)}
        ${dato('Usuario', d.usuario)}
        ${dato('DPI', d.dpi)}
        ${dato('NIT', d.nit)}
        ${dato('Teléfono', d.telefono)}
        ${dato('Correo', d.correo)}
        ${dato('Dirección', d.direccion)}
        ${dato('Fecha de registro', formatoFechaHora(d.creado_en))}
        ${dato('Último acceso', d.ultimo_acceso ? formatoFechaHora(d.ultimo_acceso) : 'Nunca')}
        ${dato('Estado cuenta', d.activo ? 'Activo' : 'Inactivo')}
        ${dato('Suscripción', d.estado_calculado)}
        ${dato('Hoteles', d.hoteles.length + ' (' + d.hoteles.filter((h) => h.activo).length + ' activos)')}
      </div>
      <div class="campo" style="margin-top:14px"><label>Observaciones</label>
        <div class="vl" style="font-size:14px">${escapar(d.observaciones) || '—'}</div></div>`,
    pie: '<button class="boton secundario" id="mv-cerrar">Cerrar</button>'
  });
  document.getElementById('mv-cerrar').addEventListener('click', cerrarModal);
}

// ---------------- Crear / editar propietario ----------------
function modalDueno(dueno) {
  const g = (k) => (dueno && dueno[k] ? escapar(dueno[k]) : '');
  abrirModal({
    titulo: dueno ? `Editar propietario · ${escapar(dueno.nombre)}` : 'Nuevo propietario',
    ancho: true,
    cuerpo: `
      <div class="campo"><label>Nombre completo</label>
        <input id="md-nombre" value="${dueno ? escapar(dueno.nombre) : ''}" maxlength="100"></div>
      <div class="fila-campos">
        <div class="campo"><label>DPI / Documento</label><input id="md-dpi" maxlength="20" value="${g('dpi')}"></div>
        <div class="campo"><label>NIT (opcional)</label><input id="md-nit" maxlength="20" value="${g('nit')}"></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Teléfono</label><input id="md-telefono" maxlength="25" value="${g('telefono')}"></div>
        <div class="campo"><label>Correo electrónico</label><input id="md-correo" type="email" maxlength="100" value="${g('correo')}"></div>
      </div>
      <div class="campo"><label>Dirección</label><input id="md-direccion" maxlength="200" value="${g('direccion')}"></div>
      ${dueno ? '' : `
      <div class="fila-campos">
        <div class="campo"><label>Usuario de acceso</label>
          <input id="md-usuario" maxlength="50" autocapitalize="none">
          <div class="ayuda">3 a 50 caracteres: letras, números, punto o guion</div></div>
        <div class="campo"><label>Vencimiento inicial (opcional)</label>
          <input id="md-vencimiento" type="date">
          <div class="ayuda">Vacío = un mes desde hoy</div></div>
      </div>`}
      <div class="campo"><label>${dueno ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña'}</label>
        <input id="md-password" type="password" maxlength="72">
        <div class="ayuda">Mínimo 6 caracteres</div></div>
      <div class="campo"><label>Observaciones</label>
        <textarea id="md-observaciones" maxlength="500" rows="2">${g('observaciones')}</textarea></div>`,
    pie: `<button class="boton secundario" id="md-cancelar">Cancelar</button>
          <button class="boton" id="md-guardar">Guardar</button>`
  });
  document.getElementById('md-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('md-guardar').addEventListener('click', async () => {
    const ficha = {
      nombre: valorModal('#md-nombre'),
      dpi: valorModal('#md-dpi'),
      nit: valorModal('#md-nit'),
      telefono: valorModal('#md-telefono'),
      correo: valorModal('#md-correo'),
      direccion: valorModal('#md-direccion'),
      observaciones: valorModal('#md-observaciones')
    };
    let respuesta;
    if (dueno) {
      respuesta = await apiPut(`/superadmin/duenos/${dueno.id}`, {
        ...ficha, password: valorModal('#md-password') || undefined
      });
    } else {
      respuesta = await apiPost('/superadmin/duenos', {
        ...ficha,
        usuario: valorModal('#md-usuario'),
        password: document.querySelector('.fondo-modal #md-password').value,
        fecha_vencimiento: valorModal('#md-vencimiento') || undefined
      });
    }
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarDuenos(); }
  });
}

// ---------------- Pago de mensualidad ----------------
function modalPago(dueno) {
  const mesActual = new Date().toISOString().slice(0, 7);
  abrirModal({
    titulo: `Registrar pago · ${escapar(dueno.nombre)}`,
    cuerpo: `
      <div class="desglose">
        <div class="linea"><span>Estado actual</span><span>${etiquetaEstado(dueno.estado_calculado)}</span></div>
        <div class="linea"><span>Vencimiento actual</span><strong>${formatoFecha(dueno.fecha_vencimiento)}</strong></div>
      </div>
      <div class="fila-campos">
        <div class="campo"><label>Monto (Q)</label>
          <input id="mp-monto" type="number" min="0.01" step="0.01" inputmode="decimal"></div>
        <div class="campo"><label>Mes correspondiente</label>
          <input id="mp-mes" type="month" value="${mesActual}"></div>
      </div>
      <div class="campo"><label>Nota (opcional)</label>
        <input id="mp-nota" maxlength="200"></div>
      <div class="ayuda suave">El pago extiende el vencimiento un mes y reactiva la cuenta si estaba suspendida.</div>`,
    pie: `<button class="boton secundario" id="mp-cancelar">Cancelar</button>
          <button class="boton" id="mp-guardar">Registrar pago</button>`
  });
  document.getElementById('mp-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mp-guardar').addEventListener('click', async () => {
    const respuesta = await apiPost(`/superadmin/duenos/${dueno.id}/pagos`, {
      monto: Number(valorModal('#mp-monto')),
      mes_correspondiente: valorModal('#mp-mes') || undefined,
      nota: valorModal('#mp-nota')
    });
    avisoRespuesta(respuesta);
    if (respuesta.success) {
      cerrarModal();
      aviso('Nuevo vencimiento: ' + formatoFecha(respuesta.data.nueva_fecha_vencimiento));
      await cargarDuenos();
    }
  });
}

// ---------------- Suspensión ----------------
function suspenderDueno(dueno, suspender) {
  abrirModal({
    titulo: suspender ? 'Suspender cuenta' : 'Reactivar cuenta',
    cuerpo: `<p style="font-size:14.5px;line-height:1.5">
      ${suspender
        ? `¿Suspender a <strong>${escapar(dueno.nombre)}</strong>?<br><span class="suave">Ni el dueño ni sus trabajadores podrán ingresar al sistema.</span>`
        : `¿Reactivar a <strong>${escapar(dueno.nombre)}</strong>?<br><span class="suave">Si la suscripción está vencida seguirá bloqueada hasta registrar un pago.</span>`}</p>`,
    pie: `<button class="boton secundario" id="ms-cancelar">Cancelar</button>
          <button class="boton ${suspender ? 'peligro' : 'exito'}" id="ms-confirmar">${suspender ? 'Suspender' : 'Reactivar'}</button>`
  });
  document.getElementById('ms-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('ms-confirmar').addEventListener('click', async () => {
    const respuesta = await apiPost(`/superadmin/duenos/${dueno.id}/${suspender ? 'suspender' : 'reactivar'}`);
    avisoRespuesta(respuesta);
    cerrarModal();
    await cargarDuenos();
  });
}

// ---------------- Eliminación definitiva del propietario ----------------
function modalEliminarDueno(dueno) {
  abrirModal({
    titulo: `Eliminar definitivamente · ${escapar(dueno.nombre)}`,
    cuerpo: `
      <p style="font-size:14px;line-height:1.55">
        Esta acción <strong>no se puede deshacer</strong>: se borrarán sus
        ${dueno.hoteles.length} hotel(es) con habitaciones, tarifas, trabajadores,
        estancias, cobros, reservas, inventario y el historial de pagos.<br>
        <span class="suave">Si solo dejó de pagar temporalmente, use "Suspender".
        No se permite eliminar si hay estancias activas sin liquidar.</span>
      </p>
      <div class="campo" style="margin-top:14px">
        <label>Para confirmar, escriba el usuario del dueño: <strong style="color:var(--rojo)">${escapar(dueno.usuario)}</strong></label>
        <input id="med-confirmar" maxlength="50" autocapitalize="none" autocomplete="off" spellcheck="false">
      </div>`,
    pie: `<button class="boton secundario" id="med-cancelar">Cancelar</button>
          <button class="boton peligro" id="med-eliminar">Eliminar definitivamente</button>`
  });
  document.getElementById('med-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('med-eliminar').addEventListener('click', async () => {
    const confirmacion = valorModal('#med-confirmar');
    if (!confirmacion) return aviso('Escriba el usuario del dueño para confirmar', true);
    const respuesta = await apiDelete(`/superadmin/duenos/${dueno.id}`, { confirmar_usuario: confirmacion });
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarDuenos(); }
  });
}

// ---------------- Historial de pagos ----------------
async function modalHistorial(dueno) {
  const respuesta = await api(`/superadmin/duenos/${dueno.id}/pagos`);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const pagos = respuesta.data.pagos;
  abrirModal({
    titulo: `Historial de pagos · ${escapar(dueno.nombre)}`,
    ancho: true,
    cuerpo: pagos.length ? `
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Fecha</th><th>Mes</th><th class="derecha">Monto</th><th>Nota</th><th>Registró</th></tr></thead>
        <tbody>${pagos.map((p) => `
          <tr>
            <td>${formatoFechaHora(p.fecha_pago)}</td>
            <td>${escapar(p.mes_correspondiente)}</td>
            <td class="derecha monto"><strong>${formatoQ(p.monto)}</strong></td>
            <td class="suave">${escapar(p.nota) || '—'}</td>
            <td class="suave">${escapar(p.registrado_por_nombre)}</td>
          </tr>`).join('')}
        </tbody>
        <tr class="total"><td colspan="2">Total</td>
          <td class="derecha monto">${formatoQ(pagos.reduce((a, p) => a + Number(p.monto), 0))}</td><td colspan="2"></td></tr>
      </table></div>`
      : `<div class="vacio"><span class="ico">${icono('dinero', 26)}</span>Sin pagos registrados</div>`,
    pie: '<button class="boton secundario" id="mh-cerrar">Cerrar</button>'
  });
  document.getElementById('mh-cerrar').addEventListener('click', cerrarModal);
}

// ---------------- Crear / editar hotel ----------------
function modalHotel(dueno, hotel) {
  abrirModal({
    titulo: hotel ? `Editar hotel · ${escapar(hotel.nombre)}` : `Nuevo hotel para ${escapar(dueno.nombre)}`,
    cuerpo: `
      <div class="campo"><label>Nombre del hotel</label>
        <input id="mh-nombre" value="${hotel ? escapar(hotel.nombre) : ''}" maxlength="100"></div>
      <div class="campo"><label>Dirección</label>
        <input id="mh-direccion" value="${hotel ? escapar(hotel.direccion) : ''}" maxlength="200"></div>
      <div class="fila-campos">
        <div class="campo"><label>Alerta limpieza (min)</label>
          <input id="mh-limpieza" type="number" min="1" max="1440" value="${hotel ? hotel.minutos_alerta_limpieza : 30}"></div>
        <div class="campo"><label>Duración noche (horas)</label>
          <input id="mh-noche" type="number" min="1" max="24" value="${hotel ? hotel.horas_noche : 12}"></div>
      </div>
      ${hotel ? `
      <div class="campo"><label>Estado (desactivación lógica)</label>
        <select id="mh-activo">
          <option value="1" ${hotel.activo ? 'selected' : ''}>Activo</option>
          <option value="0" ${!hotel.activo ? 'selected' : ''}>Inactivo (no opera, se conserva su historial)</option>
        </select></div>` : ''}`,
    pie: `<button class="boton secundario" id="mh-cancelar">Cancelar</button>
          <button class="boton" id="mh-guardar">Guardar</button>`
  });
  document.getElementById('mh-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('mh-guardar').addEventListener('click', async () => {
    const datos = {
      nombre: valorModal('#mh-nombre'),
      direccion: valorModal('#mh-direccion'),
      minutos_alerta_limpieza: Number(valorModal('#mh-limpieza')),
      horas_noche: Number(valorModal('#mh-noche'))
    };
    let respuesta;
    if (hotel) {
      datos.activo = Number(valorModal('#mh-activo'));
      respuesta = await apiPut(`/superadmin/hoteles/${hotel.id}`, datos);
    } else {
      datos.dueno_id = dueno.id;
      respuesta = await apiPost('/superadmin/hoteles', datos);
    }
    avisoRespuesta(respuesta);
    if (respuesta.success) { cerrarModal(); await cargarDuenos(); }
  });
}

/**
 * Eliminar hotel: confirma y llama al DELETE. Si el backend responde
 * que hay historial (ofrecerDesactivacion / mensaje), ofrece la
 * desactivación lógica sin afectar a los demás hoteles del dueño.
 */
function modalEliminarHotel(dueno, hotel) {
  abrirModal({
    titulo: `Eliminar hotel · ${escapar(hotel.nombre)}`,
    cuerpo: `
      <p style="font-size:14px;line-height:1.55">
        Se eliminará <strong>únicamente</strong> el hotel "${escapar(hotel.nombre)}"
        (sus habitaciones, tarifas y productos). No afecta a los demás hoteles de
        <strong>${escapar(dueno.nombre)}</strong> ni a su ficha.<br>
        <span class="suave">Si el hotel tiene historial (estancias, cobros, reservas…),
        la ley del negocio impide borrarlo: solo se podrá desactivar.</span>
      </p>
      <div class="campo" style="margin-top:8px">
        <label>Escriba <strong style="color:var(--rojo)">ELIMINAR</strong> para confirmar</label>
        <input id="meh-confirmar" maxlength="20" autocomplete="off" spellcheck="false" placeholder="ELIMINAR">
      </div>`,
    pie: `<button class="boton secundario" id="meh-cancelar">Cancelar</button>
          <button class="boton peligro" id="meh-eliminar">Eliminar hotel</button>`
  });
  document.getElementById('meh-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('meh-eliminar').addEventListener('click', async () => {
    if (valorModal('#meh-confirmar') !== 'ELIMINAR') return aviso('Escriba ELIMINAR para confirmar', true);
    const respuesta = await apiDelete(`/superadmin/hoteles/${hotel.id}`);
    if (respuesta.success) {
      avisoRespuesta(respuesta);
      cerrarModal();
      await cargarDuenos();
      return;
    }
    // El backend bloqueó por historial: ofrecer desactivación
    cerrarModal();
    abrirModal({
      titulo: `No se puede eliminar · ${escapar(hotel.nombre)}`,
      cuerpo: `<p style="font-size:14px;line-height:1.55">${escapar(respuesta.message)}</p>
        <p class="suave" style="font-size:13px;margin-top:8px">¿Desea <strong>desactivarlo</strong> en su lugar?
        El hotel dejará de operar pero conservará todo su historial.</p>`,
      pie: `<button class="boton secundario" id="meh2-cancelar">Cancelar</button>
            <button class="boton" id="meh2-desactivar">Desactivar hotel</button>`
    });
    document.getElementById('meh2-cancelar').addEventListener('click', cerrarModal);
    document.getElementById('meh2-desactivar').addEventListener('click', async () => {
      const r = await apiPut(`/superadmin/hoteles/${hotel.id}`, {
        nombre: hotel.nombre, direccion: hotel.direccion,
        minutos_alerta_limpieza: hotel.minutos_alerta_limpieza,
        horas_noche: hotel.horas_noche, activo: 0
      });
      avisoRespuesta(r);
      if (r.success) { cerrarModal(); await cargarDuenos(); }
    });
  });
}
