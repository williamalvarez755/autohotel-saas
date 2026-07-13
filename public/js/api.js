// ============================================================
// Cliente de la API. Todas las llamadas pasan por aquí:
// - Formato estándar { success, message, data }.
// - Sesión expirada (401) -> redirige al login.
// - Cuenta suspendida (403 con mensaje de suspensión) -> avisa
//   y redirige al login.
// ============================================================

const API_BASE = '/api';

async function api(ruta, opciones = {}) {
  const configuracion = {
    method: opciones.method || (opciones.body ? 'POST' : 'GET'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }
  };
  if (opciones.body !== undefined) {
    configuracion.body = JSON.stringify(opciones.body);
  }

  let respuesta;
  let json;
  try {
    respuesta = await fetch(API_BASE + ruta, configuracion);
    json = await respuesta.json();
  } catch (error) {
    return { success: false, message: 'No se pudo conectar con el servidor', data: null, status: 0 };
  }

  json.status = respuesta.status;

  const enLogin = window.location.pathname === '/' || window.location.pathname === '/index.html';

  // Sesión expirada: volver al login (salvo que ya estemos en él)
  if (respuesta.status === 401 && !ruta.startsWith('/auth/login') && !enLogin) {
    window.location.href = '/';
    return json;
  }
  // Cuenta suspendida a media sesión: avisar y volver al login
  if (respuesta.status === 403 && json.message && json.message.includes('suspendido') && !enLogin) {
    aviso(json.message, true);
    setTimeout(() => { window.location.href = '/'; }, 1800);
    return json;
  }
  return json;
}

const apiGet = (ruta) => api(ruta);
const apiPost = (ruta, body = {}) => api(ruta, { method: 'POST', body });
const apiPut = (ruta, body = {}) => api(ruta, { method: 'PUT', body });
