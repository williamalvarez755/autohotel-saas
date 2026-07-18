// ============================================================
// Componente reutilizable de "tabla de resultados" para el panel
// del superadmin (Consultas Avanzadas y otros listados):
//   - Búsqueda en tiempo real (ignora acentos/mayúsculas).
//   - Ordenamiento por columna (clic en la cabecera, asc/desc).
//   - Exportar a Excel (CSV UTF-8), a PDF e Imprimir (vía diálogo
//     de impresión del navegador; sin librerías externas por CSP).
//
// Recibe un arreglo de objetos planos (todos con las mismas claves)
// y una configuración de formato por columna. No conoce el dominio:
// el llamador decide etiquetas y formatos.
// ============================================================

/** Prettifica el nombre de una columna: "usuario_nombre" → "Usuario nombre". */
function etiquetaColumna(clave) {
  const t = String(clave).replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Formatea un valor de celda según el tipo declarado para su columna. */
function formatoCelda(valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (tipo === 'moneda') return formatoQ(valor);
  if (tipo === 'fecha') return formatoFecha(valor);
  if (tipo === 'fechahora') return formatoFechaHora(valor);
  return String(valor);
}

/** Adivina el tipo de una columna por su nombre (si no se declaró). */
function tipoPorNombre(clave) {
  const c = clave.toLowerCase();
  if (/total|monto|precio|efectivo|transferencia|cargo|vendido|inicial|declarado|sistema|descuadre/.test(c)) return 'moneda';
  if (/fecha_hora|creado_en|ultimo_acceso|ultima_|apertura|cierre|entrada|salida|_pago|^fecha$/.test(c)) return 'fechahora';
  if (/dia|vencimiento/.test(c)) return 'fecha';
  return 'texto';
}

/**
 * Renderiza la tabla con barra de herramientas dentro de `contenedor`.
 * opciones: { titulo, formatos:{col:'moneda'|'fecha'|'fechahora'|'texto'},
 *             vacio:'mensaje', nombreArchivo:'consulta' }
 */
function renderTablaResultados(contenedor, filas, opciones = {}) {
  const titulo = opciones.titulo || 'Resultados';
  const nombreArchivo = opciones.nombreArchivo || 'consulta';

  if (!filas || !filas.length) {
    contenedor.innerHTML = `<div class="vacio"><span class="ico">${icono('tabla', 26)}</span>${escapar(opciones.vacio || 'Sin resultados para los filtros seleccionados')}</div>`;
    return;
  }

  const columnas = Object.keys(filas[0]);
  const tipos = {};
  columnas.forEach((c) => { tipos[c] = (opciones.formatos && opciones.formatos[c]) || tipoPorNombre(c); });

  // Estado local del componente (orden y filtro)
  const estado = { ordenCol: null, ordenAsc: true, criterio: '' };

  contenedor.innerHTML = `
    <div class="panel">
      <div class="barra-reporte">
        <div class="buscador-pos" style="margin-bottom:0;flex:1;min-width:200px">
          <span class="lupa">${icono('lupa', 16)}</span>
          <input type="search" class="rt-buscar" placeholder="Buscar en los resultados…" autocomplete="off" spellcheck="false">
        </div>
        <div class="rt-contador suave"></div>
        <div class="fila-flex">
          <button class="boton secundario chico rt-excel">${icono('descargar', 14)} Excel</button>
          <button class="boton secundario chico rt-pdf">${icono('documento', 14)} PDF</button>
          <button class="boton secundario chico rt-imprimir">${icono('imprimir', 14)} Imprimir</button>
        </div>
      </div>
      <div class="envoltura-tabla"><table class="tabla rt-tabla">
        <thead><tr>${columnas.map((c) =>
          `<th class="rt-th" data-col="${escapar(c)}" style="cursor:pointer;user-select:none">
             ${escapar(etiquetaColumna(c))} <span class="rt-flecha suave"></span></th>`).join('')}
        </tr></thead>
        <tbody class="rt-cuerpo"></tbody>
      </table></div>
    </div>`;

  const cuerpo = contenedor.querySelector('.rt-cuerpo');
  const contador = contenedor.querySelector('.rt-contador');
  const inputBuscar = contenedor.querySelector('.rt-buscar');

  const filasVisibles = () => {
    let lista = filas;
    if (estado.criterio) {
      const q = normalizarBusqueda(estado.criterio);
      lista = lista.filter((f) => columnas.some((c) =>
        normalizarBusqueda(formatoCelda(f[c], tipos[c])).includes(q)));
    }
    if (estado.ordenCol) {
      const col = estado.ordenCol;
      lista = [...lista].sort((a, b) => {
        const va = a[col]; const vb = b[col];
        const na = Number(va); const nb = Number(vb);
        let cmp;
        if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') cmp = na - nb;
        else cmp = String(va === null ? '' : va).localeCompare(String(vb === null ? '' : vb), 'es');
        return estado.ordenAsc ? cmp : -cmp;
      });
    }
    return lista;
  };

  const dibujar = () => {
    const lista = filasVisibles();
    cuerpo.innerHTML = lista.map((f) => `<tr>${columnas.map((c) => {
      const tipo = tipos[c];
      const clase = tipo === 'moneda' ? ' class="derecha monto"' : '';
      return `<td${clase}>${escapar(formatoCelda(f[c], tipo))}</td>`;
    }).join('')}</tr>`).join('');
    contador.textContent = `${lista.length} de ${filas.length} fila(s)`;
    contenedor.querySelectorAll('.rt-flecha').forEach((s) => (s.textContent = ''));
    if (estado.ordenCol) {
      const th = contenedor.querySelector(`.rt-th[data-col="${estado.ordenCol}"] .rt-flecha`);
      if (th) th.textContent = estado.ordenAsc ? '▲' : '▼';
    }
  };

  inputBuscar.addEventListener('input', () => { estado.criterio = inputBuscar.value; dibujar(); });
  contenedor.querySelectorAll('.rt-th').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (estado.ordenCol === col) estado.ordenAsc = !estado.ordenAsc;
      else { estado.ordenCol = col; estado.ordenAsc = true; }
      dibujar();
    });
  });
  contenedor.querySelector('.rt-excel').addEventListener('click', () =>
    exportarCSV(nombreArchivo, columnas, tipos, filasVisibles()));
  const imprimir = () => imprimirReporte(titulo, columnas, tipos, filasVisibles());
  contenedor.querySelector('.rt-pdf').addEventListener('click', imprimir);
  contenedor.querySelector('.rt-imprimir').addEventListener('click', imprimir);

  dibujar();
}

/** Exporta las filas visibles a CSV (UTF-8 con BOM; abre en Excel). */
function exportarCSV(nombreArchivo, columnas, tipos, filas) {
  const escaparCsv = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cabecera = columnas.map((c) => escaparCsv(etiquetaColumna(c))).join(',');
  const cuerpo = filas.map((f) =>
    columnas.map((c) => escaparCsv(formatoCelda(f[c], tipos[c]))).join(',')).join('\r\n');
  const csv = '﻿' + cabecera + '\r\n' + cuerpo;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `${nombreArchivo}-${hoyLocal()}.csv`;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  aviso('Exportado a Excel (CSV)');
}

/**
 * Imprime / genera PDF vía el diálogo del navegador. Monta una zona
 * de impresión oculta (solo visible al imprimir) y llama a print();
 * así evita bloqueadores de ventanas emergentes y respeta la CSP.
 */
function imprimirReporte(titulo, columnas, tipos, filas) {
  const previa = document.getElementById('zona-impresion');
  if (previa) previa.remove();

  const zona = document.createElement('div');
  zona.id = 'zona-impresion';
  zona.innerHTML = `
    <div class="cabecera-impresion">
      <h1>${escapar(titulo)}</h1>
      <div class="meta-impresion">AutoHotel · Generado el ${formatoFechaHora(new Date().toISOString().slice(0, 19).replace('T', ' '))} · ${filas.length} registro(s)</div>
    </div>
    <table class="tabla-impresion">
      <thead><tr>${columnas.map((c) => `<th>${escapar(etiquetaColumna(c))}</th>`).join('')}</tr></thead>
      <tbody>${filas.map((f) => `<tr>${columnas.map((c) =>
        `<td>${escapar(formatoCelda(f[c], tipos[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  document.body.appendChild(zona);
  window.print();
  setTimeout(() => zona.remove(), 500);
}
