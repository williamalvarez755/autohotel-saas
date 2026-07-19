// ============================================================
// Módulo Respaldos del superadmin.
// - Descargar el respaldo completo del sistema (JSON).
// - Restaurar desde un archivo: se lee en el navegador, se
//   muestra el resumen (fecha, filas por tabla) y solo se envía
//   tras doble confirmación (checkbox + escribir RESTAURAR).
// - Respaldos guardados en el servidor (automáticos de limpieza
//   y pre-restauración) listados y descargables.
// El backend valida TODO de nuevo: esta pantalla solo guía.
// ============================================================

let respaldoCargado = null;
let nombreArchivoCargado = '';

function formatoBytes(bytes) {
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

async function cargarRespaldos() {
  respaldoCargado = null;
  nombreArchivoCargado = '';
  const seccion = document.getElementById('seccion-respaldos');
  seccion.innerHTML = `
    <div class="encabezado-seccion">
      <div>
        <h2>Respaldos</h2>
        <div class="sub">Copia de seguridad completa del sistema y restauración</div>
      </div>
    </div>

    <div class="malla-2col" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:14px">
      <div class="panel" style="padding:18px">
        <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${icono('descargar', 18)} Descargar respaldo completo</h3>
        <p class="suave" style="font-size:13.5px;margin-bottom:12px">
          Genera un archivo JSON con TODA la información del sistema: propietarios,
          hoteles, habitaciones, tarifas, extras, inventario, estancias, cobros,
          cajas, reservas y auditoría. Guárdelo en un lugar seguro.</p>
        <button class="boton" id="resp-descargar">${icono('descargar', 15)} Descargar respaldo</button>
        <div class="ayuda suave" style="margin-top:8px">La descarga queda registrada en la auditoría.</div>
      </div>

      <div class="panel" style="padding:18px;border:1px solid var(--rojo)">
        <h3 style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${icono('alerta', 18)} Restaurar desde archivo</h3>
        <p class="suave" style="font-size:13.5px;margin-bottom:12px">
          <strong style="color:var(--rojo)">Reemplaza TODOS los datos actuales</strong> por los del
          respaldo. Antes de restaurar, el sistema guarda automáticamente una copia
          del estado actual en el servidor.</p>
        <input type="file" id="resp-archivo" accept="application/json,.json" class="oculto">
        <button class="boton secundario" id="resp-elegir">${icono('mas', 15)} Elegir archivo de respaldo…</button>
        <div id="resp-resumen" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="panel" style="padding:18px">
      <h3 style="margin-bottom:10px">Respaldos guardados en el servidor</h3>
      <p class="suave" style="font-size:13px;margin-bottom:10px">
        Copias automáticas: pre-restauración y limpiezas programadas.</p>
      <div id="resp-lista-servidor"></div>
    </div>`;

  document.getElementById('resp-descargar').addEventListener('click', () => {
    window.location.href = '/api/superadmin/respaldo';
    aviso('Generando respaldo… la descarga comenzará en unos segundos');
  });

  const inputArchivo = document.getElementById('resp-archivo');
  document.getElementById('resp-elegir').addEventListener('click', () => inputArchivo.click());
  inputArchivo.addEventListener('change', () => leerArchivoRespaldo(inputArchivo));

  await dibujarRespaldosServidor();
}

async function dibujarRespaldosServidor() {
  const contenedor = document.getElementById('resp-lista-servidor');
  const respuesta = await api('/superadmin/respaldo/archivos');
  if (!respuesta.success) return avisoRespuesta(respuesta);
  const archivos = respuesta.data;

  contenedor.innerHTML = archivos.length ? `
    <div class="envoltura-tabla"><table class="tabla">
      <thead><tr><th>Archivo</th><th>Fecha</th><th class="derecha">Tamaño</th><th></th></tr></thead>
      <tbody>${archivos.map((a) => `
        <tr>
          <td><strong>${escapar(a.nombre)}</strong></td>
          <td class="suave">${formatoFechaHora(a.modificado)}</td>
          <td class="derecha">${formatoBytes(a.bytes)}</td>
          <td class="derecha"><button class="boton secundario mini" data-descargar="${escapar(a.nombre)}">Descargar</button></td>
        </tr>`).join('')}
      </tbody></table></div>`
    : '<div class="vacio" style="padding:14px"><span class="ico">' + icono('caja', 24) + '</span>Aún no hay respaldos guardados en el servidor</div>';

  contenedor.querySelectorAll('[data-descargar]').forEach((b) => {
    b.addEventListener('click', () => {
      window.location.href = '/api/superadmin/respaldo/archivos/' + encodeURIComponent(b.dataset.descargar);
    });
  });
}

/** Lee y valida (superficialmente) el archivo elegido; el backend revalida todo. */
async function leerArchivoRespaldo(input) {
  const zona = document.getElementById('resp-resumen');
  respaldoCargado = null;
  const archivo = input.files && input.files[0];
  if (!archivo) return;
  if (archivo.size > 50 * 1024 * 1024) {
    zona.innerHTML = '<div class="etiqueta roja">El archivo excede el máximo de 50 MB</div>';
    return;
  }

  let datos;
  try {
    datos = JSON.parse(await archivo.text());
  } catch (e) {
    zona.innerHTML = '<div class="etiqueta roja">El archivo no es un JSON válido</div>';
    return;
  }
  if (!datos || datos.sistema !== 'autohotel-saas' || !datos.tablas) {
    zona.innerHTML = '<div class="etiqueta roja">El archivo no es un respaldo de AutoHotel SaaS</div>';
    return;
  }

  respaldoCargado = datos;
  nombreArchivoCargado = archivo.name;
  const tablas = Object.keys(datos.tablas);
  const totalFilas = tablas.reduce((s, t) => s + (Array.isArray(datos.tablas[t]) ? datos.tablas[t].length : 0), 0);

  zona.innerHTML = `
    <div class="desglose" style="margin-bottom:10px">
      <div class="linea"><span>Archivo</span><strong>${escapar(nombreArchivoCargado)}</strong></div>
      <div class="linea"><span>Generado</span><strong>${escapar(String(datos.generado || 'sin fecha'))}</strong></div>
      <div class="linea"><span>Tablas / filas</span><strong>${tablas.length} / ${totalFilas}</strong></div>
    </div>
    <details style="margin-bottom:12px"><summary class="suave" style="cursor:pointer;font-size:13px">Ver filas por tabla</summary>
      <div style="margin-top:6px;font-size:12.5px;columns:2">${tablas.map((t) =>
        `<div>${escapar(t)}: <strong>${Array.isArray(datos.tablas[t]) ? datos.tablas[t].length : 0}</strong></div>`).join('')}</div>
    </details>
    <label style="display:flex;gap:8px;align-items:flex-start;font-size:13.5px;margin-bottom:10px;cursor:pointer">
      <input type="checkbox" id="resp-entiendo" style="margin-top:2px">
      <span>Entiendo que se <strong>reemplazarán todos los datos actuales</strong> y que las
      demás sesiones se cerrarán.</span></label>
    <div class="campo"><label>Escriba <strong>RESTAURAR</strong> para confirmar</label>
      <input id="resp-confirmacion" autocomplete="off" spellcheck="false" placeholder="RESTAURAR"></div>
    <button class="boton peligro" id="resp-restaurar" disabled>${icono('alerta', 15)} Restaurar este respaldo</button>`;

  const check = document.getElementById('resp-entiendo');
  const confirmacion = document.getElementById('resp-confirmacion');
  const botonRestaurar = document.getElementById('resp-restaurar');
  const revisar = () => {
    botonRestaurar.disabled = !(check.checked && confirmacion.value.trim() === 'RESTAURAR');
  };
  check.addEventListener('change', revisar);
  confirmacion.addEventListener('input', revisar);

  botonRestaurar.addEventListener('click', async () => {
    botonRestaurar.disabled = true;
    botonRestaurar.textContent = 'Restaurando…';
    const respuesta = await apiPost('/superadmin/respaldo/restaurar', {
      confirmacion: confirmacion.value.trim(),
      respaldo: respaldoCargado
    });
    if (!respuesta.success) {
      botonRestaurar.disabled = false;
      botonRestaurar.innerHTML = `${icono('alerta', 15)} Restaurar este respaldo`;
      return avisoRespuesta(respuesta);
    }
    aviso('Respaldo restaurado correctamente');
    await cargarRespaldos();
    // Si las credenciales del respaldo son otras, la próxima petición
    // pedirá login de nuevo (api.js redirige solo).
  });
}
