// ============================================================
// Panel del superadmin: dueños, hoteles, suscripciones y pagos.
// ============================================================

let duenos = [];

// ---------------- Arranque ----------------
(async function iniciar() {
  const sesion = await api('/auth/sesion');
  if (!sesion.success) return; // api.js redirige al login
  if (sesion.data.rol !== 'superadmin') {
    window.location.href = sesion.data.redirect;
    return;
  }
  document.getElementById('nombre-usuario').textContent = sesion.data.nombre;
  await cargarDuenos();
})();

document.getElementById('boton-salir').addEventListener('click', async () => {
  await apiPost('/auth/logout');
  window.location.href = '/';
});

document.getElementById('boton-nuevo-dueno').addEventListener('click', () => modalDueno(null));

// ---------------- Listado ----------------
async function cargarDuenos() {
  const respuesta = await api('/superadmin/duenos');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  duenos = respuesta.data;
  dibujarDuenos();
}

function etiquetaEstado(estado) {
  const mapa = {
    activa: ['verde', 'Activa'],
    por_vencer: ['amarilla', 'Por vencer'],
    vencida: ['roja', 'Vencida'],
    suspendida: ['gris', 'Suspendida']
  };
  const [clase, texto] = mapa[estado] || ['gris', estado];
  return `<span class="etiqueta ${clase}">${texto}</span>`;
}

function dibujarDuenos() {
  const contenedor = document.getElementById('lista-duenos');
  if (!duenos.length) {
    contenedor.innerHTML = '<div class="vacio"><span class="ico">' + icono('usuarios', 26) + '</span>Aún no hay dueños registrados</div>';
    return;
  }

  contenedor.innerHTML = duenos.map((d) => `
    <div class="panel" data-dueno="${d.id}">
      <div class="fila-flex" style="justify-content:space-between">
        <div>
          <div class="fila-flex" style="gap:10px">
            <strong style="font-size:16px">${escapar(d.nombre)}</strong>
            ${etiquetaEstado(d.estado_calculado)}
          </div>
          <div class="suave" style="font-size:13px;margin-top:4px">
            Usuario: <strong>${escapar(d.usuario)}</strong> ·
            Vence: <strong>${formatoFecha(d.fecha_vencimiento)}</strong> ·
            ${d.trabajadores_activos} trabajador(es) activo(s)
          </div>
        </div>
        <div class="fila-flex">
          <button class="boton chico" data-accion="pago">${icono('dinero', 14)} Registrar pago</button>
          ${d.estado_calculado === 'suspendida'
            ? '<button class="boton exito chico" data-accion="reactivar">Reactivar</button>'
            : '<button class="boton peligro chico" data-accion="suspender">Suspender</button>'}
          <button class="boton secundario chico" data-accion="editar">Editar</button>
          <button class="boton secundario chico" data-accion="historial">Historial</button>
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
                <td class="derecha"><button class="boton secundario mini" data-accion="editar-hotel" data-hotel="${h.id}">Editar</button></td>
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
      if (accion === 'pago') modalPago(dueno);
      if (accion === 'suspender') suspenderDueno(dueno, true);
      if (accion === 'reactivar') suspenderDueno(dueno, false);
      if (accion === 'editar') modalDueno(dueno);
      if (accion === 'historial') modalHistorial(dueno);
      if (accion === 'nuevo-hotel') modalHotel(dueno, null);
      if (accion === 'editar-hotel') {
        const hotel = dueno.hoteles.find((h) => h.id === Number(boton.dataset.hotel));
        modalHotel(dueno, hotel);
      }
    });
  });
}

// ---------------- Crear / editar dueño ----------------
function modalDueno(dueno) {
  abrirModal({
    titulo: dueno ? 'Editar dueño' : 'Nuevo dueño',
    cuerpo: `
      <div class="campo"><label>Nombre completo</label>
        <input id="md-nombre" value="${dueno ? escapar(dueno.nombre) : ''}" maxlength="100"></div>
      ${dueno ? '' : `
      <div class="campo"><label>Usuario de acceso</label>
        <input id="md-usuario" maxlength="50" autocapitalize="none">
        <div class="ayuda">3 a 50 caracteres: letras, números, punto o guion</div></div>`}
      <div class="campo"><label>${dueno ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña'}</label>
        <input id="md-password" type="password" maxlength="72">
        <div class="ayuda">Mínimo 6 caracteres</div></div>
      ${dueno ? '' : `
      <div class="campo"><label>Vencimiento inicial (opcional)</label>
        <input id="md-vencimiento" type="date">
        <div class="ayuda">Si se deja vacío: un mes a partir de hoy</div></div>`}`,
    pie: `<button class="boton secundario" id="md-cancelar">Cancelar</button>
          <button class="boton" id="md-guardar">Guardar</button>`
  });
  document.getElementById('md-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('md-guardar').addEventListener('click', async () => {
    let respuesta;
    if (dueno) {
      respuesta = await apiPut(`/superadmin/duenos/${dueno.id}`, {
        nombre: valorModal('#md-nombre'),
        password: valorModal('#md-password') || undefined
      });
    } else {
      respuesta = await apiPost('/superadmin/duenos', {
        nombre: valorModal('#md-nombre'),
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
      : '<div class="vacio"><span class="ico">' + icono('dinero', 26) + '</span>Sin pagos registrados</div>',
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
      <div class="campo"><label>Estado</label>
        <select id="mh-activo">
          <option value="1" ${hotel.activo ? 'selected' : ''}>Activo</option>
          <option value="0" ${!hotel.activo ? 'selected' : ''}>Inactivo</option>
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
