// ============================================================
// Tema visual (oscuro por defecto / claro opcional).
// Solo presentación: alterna el atributo data-tema en <html>
// y lo recuerda en localStorage. Se carga en <head> para
// aplicar el tema guardado antes del primer pintado.
// ============================================================

(function aplicarTemaGuardado() {
  try {
    if (localStorage.getItem('autohotel-tema') === 'claro') {
      document.documentElement.setAttribute('data-tema', 'claro');
    }
  } catch (e) { /* localStorage bloqueado: se queda el tema oscuro */ }
})();

function alternarTema() {
  const raiz = document.documentElement;
  const aClaro = raiz.getAttribute('data-tema') !== 'claro';
  if (aClaro) raiz.setAttribute('data-tema', 'claro');
  else raiz.removeAttribute('data-tema');
  try { localStorage.setItem('autohotel-tema', aClaro ? 'claro' : 'oscuro'); } catch (e) { /* sin persistencia */ }
  pintarBotonTema();
}

function pintarBotonTema() {
  const boton = document.getElementById('boton-tema');
  if (!boton || typeof icono !== 'function') return;
  const claro = document.documentElement.getAttribute('data-tema') === 'claro';
  boton.innerHTML = icono(claro ? 'luna' : 'sol', 17);
  boton.title = claro ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro';
}

document.addEventListener('DOMContentLoaded', () => {
  const boton = document.getElementById('boton-tema');
  if (boton) {
    boton.addEventListener('click', alternarTema);
    pintarBotonTema();
  }
});
