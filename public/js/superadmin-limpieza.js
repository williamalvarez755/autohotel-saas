// ============================================================
// Limpieza de datos históricos + Políticas de retención
// (superadmin). Flujo seguro de limpieza:
//   resumen → seleccionar tipos → descargar respaldo →
//   doble confirmación (checkbox + escribir ELIMINAR) → ejecutar.
// Cada ejecución queda auditada por el backend.
// ============================================================

let resumenLimpieza = null;

function fechaHaceAnios(anios) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - anios);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function cargarLimpieza() {
  const seccion = document.getElementById('seccion-limpieza');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Limpieza de datos históricos</h2>
        <div class="sub">Elimina información antigua para que la base no crezca de más</div>
      </div>
    </div>
    <div class="panel">
      <div class="fila-flex" style="align-items:flex-end">
        <div class="campo" style="margin-bottom:0"><label>Eliminar registros anteriores a</label>
          <input type="date" id="lm-fecha" value="${fechaHaceAnios(2)}"></div>
        <button class="boton" id="lm-analizar">${icono('lupa', 15)} Analizar</button>
      </div>
      <div class="ayuda suave" style="margin-top:8px">
        Se mostrará cuántos registros caerían. Antes de borrar podrá descargar un respaldo (JSON)
        y deberá confirmar dos veces. La acción queda registrada en la auditoría.
      </div>
    </div>
    <div id="lm-resultado"></div>`;
  document.getElementById('lm-analizar').addEventListener('click', analizarLimpieza);
}

async function analizarLimpieza() {
  const fecha = document.getElementById('lm-fecha').value;
  if (!fecha) return aviso('Elija una fecha límite', true);
  const respuesta = await api(`/superadmin/limpieza/resumen?fecha=${fecha}`);
  if (!respuesta.success) return avisoRespuesta(respuesta);
  resumenLimpieza = respuesta.data;

  const total = resumenLimpieza.tipos.reduce((a, t) => a + t.registros, 0);
  const zona = document.getElementById('lm-resultado');
  zona.innerHTML = `
    <div class="panel">
      <h3>Resumen — anteriores a ${formatoFecha(fecha)}</h3>
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th style="width:40px"></th><th>Tipo de información</th><th class="derecha">Registros</th></tr></thead>
        <tbody>${resumenLimpieza.tipos.map((t) => `
          <tr>
            <td class="centrado"><input type="checkbox" class="lm-tipo" value="${t.tipo}" ${t.registros ? '' : 'disabled'}></td>
            <td>${escapar(t.etiqueta)} <span class="suave">(${t.tipo})</span></td>
            <td class="derecha"><strong>${t.registros.toLocaleString('es-GT')}</strong></td>
          </tr>`).join('')}
        </tbody>
        <tr class="total"><td></td><td>Total seleccionable</td><td class="derecha">${total.toLocaleString('es-GT')}</td></tr>
      </table></div>
      <div class="fila-flex" style="margin-top:14px">
        <button class="boton secundario" id="lm-respaldo">${icono('descargar', 15)} Descargar respaldo (JSON)</button>
        <button class="boton peligro" id="lm-ejecutar">${icono('basura', 15)} Ejecutar limpieza…</button>
      </div>
    </div>`;
  document.getElementById('lm-respaldo').addEventListener('click', () => descargarRespaldo(fecha));
  document.getElementById('lm-ejecutar').addEventListener('click', () => confirmarLimpieza(fecha));
}

function tiposSeleccionados() {
  return Array.from(document.querySelectorAll('.lm-tipo:checked')).map((c) => c.value);
}

async function descargarRespaldo(fecha) {
  const tipos = tiposSeleccionados();
  if (!tipos.length) return aviso('Seleccione al menos un tipo para respaldar', true);
  try {
    const resp = await fetch(`/api/superadmin/limpieza/respaldo?fecha=${fecha}&tipos=${tipos.join(',')}`, {
      credentials: 'same-origin'
    });
    if (!resp.ok) return aviso('No se pudo generar el respaldo', true);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo-autohotel-${fecha}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    aviso('Respaldo descargado');
  } catch (e) {
    aviso('No se pudo generar el respaldo', true);
  }
}

function confirmarLimpieza(fecha) {
  const tipos = tiposSeleccionados();
  if (!tipos.length) return aviso('Seleccione al menos un tipo a eliminar', true);
  const seleccion = resumenLimpieza.tipos.filter((t) => tipos.includes(t.tipo));
  const total = seleccion.reduce((a, t) => a + t.registros, 0);

  abrirModal({
    titulo: 'Confirmar limpieza (irreversible)',
    cuerpo: `
      <p style="font-size:14px;line-height:1.55">Se eliminarán <strong>${total.toLocaleString('es-GT')}</strong>
        registro(s) anteriores a <strong>${formatoFecha(fecha)}</strong>:</p>
      <div class="desglose">
        ${seleccion.map((t) => `<div class="linea"><span>${escapar(t.etiqueta)}</span><strong>${t.registros.toLocaleString('es-GT')}</strong></div>`).join('')}
      </div>
      <label class="fila-flex" style="gap:8px;font-size:13.5px;margin:10px 0">
        <input type="checkbox" id="lc-check"> Entiendo que esta acción <strong>no se puede deshacer</strong>
      </label>
      <div class="campo"><label>Escriba <strong style="color:var(--rojo)">ELIMINAR</strong> para confirmar</label>
        <input id="lc-confirmar" maxlength="20" autocomplete="off" spellcheck="false" placeholder="ELIMINAR"></div>
      <div class="ayuda suave">Recomendación: descargue el respaldo antes de continuar.</div>`,
    pie: `<button class="boton secundario" id="lc-cancelar">Cancelar</button>
          <button class="boton peligro" id="lc-ejecutar">Eliminar definitivamente</button>`
  });
  document.getElementById('lc-cancelar').addEventListener('click', cerrarModal);
  document.getElementById('lc-ejecutar').addEventListener('click', async () => {
    if (!document.getElementById('lc-check').checked) return aviso('Marque la casilla de confirmación', true);
    if (valorModal('#lc-confirmar') !== 'ELIMINAR') return aviso('Escriba ELIMINAR para confirmar', true);
    const respuesta = await apiPost('/superadmin/limpieza/ejecutar', {
      fecha, tipos, confirmacion: 'ELIMINAR'
    });
    if (!respuesta.success) return avisoRespuesta(respuesta);
    aviso(`Limpieza ejecutada: ${respuesta.data.total_eliminados.toLocaleString('es-GT')} registro(s) eliminados`);
    cerrarModal();
    await analizarLimpieza();
  });
}

// ============================================================
// Políticas de retención
// ============================================================
const FRECUENCIAS = [['manual', 'Manual'], ['mensual', 'Mensual'], ['trimestral', 'Trimestral'], ['anual', 'Anual']];

async function cargarRetencion() {
  const respuesta = await api('/superadmin/retencion');
  const seccion = document.getElementById('seccion-retencion');
  if (!respuesta.success) { seccion.innerHTML = ''; return avisoRespuesta(respuesta); }
  const politicas = respuesta.data;

  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Políticas de retención</h2>
        <div class="sub">Cuánto conservar cada tipo y cada cuánto limpiar automáticamente</div>
      </div>
    </div>
    <div class="panel">
      <div class="envoltura-tabla"><table class="tabla">
        <thead><tr><th>Tipo de información</th><th>Conservar (meses)</th><th>Limpieza</th><th>Última ejecución</th><th></th></tr></thead>
        <tbody>${politicas.map((p) => `
          <tr data-tipo="${p.tipo}">
            <td><strong>${escapar(p.etiqueta)}</strong> <span class="suave">(${p.tipo})</span></td>
            <td><input class="rt-meses" type="number" min="0" max="240" value="${p.meses}" style="width:90px"></td>
            <td><select class="rt-prog">${FRECUENCIAS.map(([v, t]) =>
              `<option value="${v}" ${p.programada === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
            <td class="suave">${p.ultima_ejecucion ? formatoFechaHora(p.ultima_ejecucion) : 'Nunca'}</td>
            <td class="derecha"><button class="boton secundario mini rt-guardar">Guardar</button></td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="ayuda suave" style="margin-top:10px">
        La limpieza programada corre en el servidor con respaldo automático previo. Ej.: reservas 24 meses,
        auditoría 120 meses. "Manual" = solo se limpia desde el módulo de Limpieza de datos.
      </div>
    </div>`;

  seccion.querySelectorAll('.rt-guardar').forEach((boton) => {
    boton.addEventListener('click', async () => {
      const fila = boton.closest('[data-tipo]');
      const respuesta = await apiPut('/superadmin/retencion', {
        tipo: fila.dataset.tipo,
        meses: Number(fila.querySelector('.rt-meses').value),
        programada: fila.querySelector('.rt-prog').value
      });
      avisoRespuesta(respuesta);
      if (respuesta.success) await cargarRetencion();
    });
  });
}
