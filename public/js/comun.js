// ============================================================
// Utilidades compartidas del frontend: formato de moneda y
// fechas (Guatemala), avisos (toast), modales y contadores.
// ============================================================

/** Formatea un monto como Q 1,250.00 */
function formatoQ(monto) {
  const n = Number(monto || 0);
  return 'Q ' + n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'DD/MM/YYYY HH:MM' */
function formatoFechaHora(texto) {
  if (!texto) return '—';
  const t = String(texto);
  const fecha = t.slice(0, 10).split('-');
  return `${fecha[2]}/${fecha[1]}/${fecha[0]} ${t.slice(11, 16)}`;
}

/** 'YYYY-MM-DD HH:MM:SS' -> 'HH:MM' */
function formatoHora(texto) {
  return texto ? String(texto).slice(11, 16) : '—';
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY' */
function formatoFecha(texto) {
  if (!texto) return '—';
  const f = String(texto).slice(0, 10).split('-');
  return `${f[2]}/${f[1]}/${f[0]}`;
}

/** Milisegundos -> 'HH:MM:SS' (para contadores en vivo). */
function formatoDuracion(ms) {
  if (!Number.isFinite(ms)) return '—'; // epoch ausente o corrupto: nunca pintar "NaN:NaN:NaN"
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Minutos -> '2 h 15 min' */
function formatoMinutos(minutos) {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Fecha local de hoy en formato YYYY-MM-DD (para inputs date). */
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Normaliza texto para búsquedas instantáneas: minúsculas y sin
 * acentos ("Cerveza Añeja" → "cerveza aneja"). Así "anej" o "AÑEJ"
 * encuentran el mismo producto.
 */
function normalizarBusqueda(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Escapa HTML para prevenir XSS al insertar datos en el DOM. */
function escapar(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------- Avisos (toast) ----------------
function aviso(mensaje, esError = false) {
  let zona = document.querySelector('.zona-avisos');
  if (!zona) {
    zona = document.createElement('div');
    zona.className = 'zona-avisos';
    document.body.appendChild(zona);
  }
  const elemento = document.createElement('div');
  elemento.className = 'aviso' + (esError ? ' error' : '');
  elemento.textContent = mensaje;
  zona.appendChild(elemento);
  setTimeout(() => {
    elemento.style.opacity = '0';
    elemento.style.transition = 'opacity 0.3s';
    setTimeout(() => elemento.remove(), 320);
  }, 3400);
}

/** Muestra el mensaje de una respuesta de la API como aviso. */
function avisoRespuesta(respuesta) {
  aviso(respuesta.message || (respuesta.success ? 'Operación realizada' : 'Ocurrió un error'), !respuesta.success);
}

// ---------------- Modales ----------------
/**
 * Abre un modal genérico. Devuelve el elemento raíz.
 * opciones: { titulo, cuerpo (html), pie (html), ancho (bool), alCerrar }
 */
function abrirModal(opciones) {
  cerrarModal();
  const fondo = document.createElement('div');
  fondo.className = 'fondo-modal';
  fondo.innerHTML = `
    <div class="modal ${opciones.ancho ? 'ancho' : ''}" role="dialog" aria-modal="true">
      <div class="modal-cabecera">
        <h3>${opciones.titulo || ''}</h3>
        <button class="cerrar-modal" type="button" aria-label="Cerrar">×</button>
      </div>
      <div class="modal-cuerpo">${opciones.cuerpo || ''}</div>
      ${opciones.pie ? `<div class="modal-pie">${opciones.pie}</div>` : ''}
    </div>`;
  fondo.addEventListener('click', (e) => {
    if (e.target === fondo) cerrarModal();
  });
  fondo.querySelector('.cerrar-modal').addEventListener('click', cerrarModal);
  document.body.appendChild(fondo);
  const primero = fondo.querySelector('input, select, textarea');
  if (primero) setTimeout(() => primero.focus(), 60);
  return fondo;
}

function cerrarModal() {
  const abierto = document.querySelector('.fondo-modal');
  if (abierto) abierto.remove();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') cerrarModal();
});

// ---------------- Ayudas de formularios ----------------
/** Lee el valor de un input dentro del modal abierto. */
function valorModal(selector) {
  const el = document.querySelector('.fondo-modal ' + selector);
  return el ? el.value.trim() : '';
}

/** Grupo de opciones tipo botón (tipo de servicio, método de pago). */
function activarGrupoOpciones(contenedor, alCambiar) {
  contenedor.querySelectorAll('.opcion').forEach((boton) => {
    boton.addEventListener('click', () => {
      contenedor.querySelectorAll('.opcion').forEach((b) => b.classList.remove('activa'));
      boton.classList.add('activa');
      if (alCambiar) alCambiar(boton.dataset.valor);
    });
  });
}

function opcionActiva(contenedor) {
  const activa = contenedor.querySelector('.opcion.activa');
  return activa ? activa.dataset.valor : null;
}
