// ============================================================
// Pantalla de login: valida credenciales y redirige al panel
// del rol correspondiente. Si ya hay sesión abierta, entra
// directo sin pedir credenciales de nuevo.
// ============================================================

(async function verificarSesionExistente() {
  const respuesta = await api('/auth/sesion');
  if (respuesta.success && respuesta.data && respuesta.data.redirect) {
    window.location.href = respuesta.data.redirect;
  }
})();

document.getElementById('formulario-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = document.getElementById('boton-ingresar');
  boton.disabled = true;
  boton.textContent = 'Verificando...';

  const respuesta = await api('/auth/login', {
    method: 'POST',
    body: {
      usuario: document.getElementById('usuario').value.trim(),
      password: document.getElementById('password').value
    }
  });

  if (respuesta.success) {
    window.location.href = respuesta.data.redirect;
    return;
  }

  aviso(respuesta.message, true);
  boton.disabled = false;
  boton.textContent = 'Ingresar';
});
