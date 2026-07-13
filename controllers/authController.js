// ============================================================
// Controlador de autenticación.
// ============================================================

const authService = require('../services/authService');
const { ok } = require('../utils/respuesta');
const { ErrorNegocio } = require('../middleware/errores');
const v = require('../utils/validacion');

async function login(req, res) {
  const cuerpo = req.body || {};
  const usuario = v.textoRequerido(cuerpo.usuario, 'usuario', 50).toLowerCase();
  if (typeof cuerpo.password !== 'string' || !cuerpo.password) {
    throw new ErrorNegocio('El campo "contraseña" es obligatorio');
  }

  let datosUsuario;
  try {
    datosUsuario = await authService.login(usuario, cuerpo.password);
  } catch (error) {
    if (req.registrarIntentoFallido) req.registrarIntentoFallido();
    throw error;
  }
  if (req.limpiarIntentos) req.limpiarIntentos();

  // Regenerar la sesión evita fijación de sesión.
  await new Promise((resolver, rechazar) => {
    req.session.regenerate((err) => (err ? rechazar(err) : resolver()));
  });
  req.session.usuarioId = datosUsuario.id;

  const info = await authService.infoSesion(datosUsuario, req.session);
  return ok(res, info, 'Bienvenido, ' + datosUsuario.nombre);
}

async function logout(req, res) {
  await new Promise((resolver) => req.session.destroy(() => resolver()));
  res.clearCookie('autohotel.sid');
  return ok(res, {}, 'Sesión cerrada');
}

async function sesion(req, res) {
  const info = await authService.infoSesion(req.usuario, req.session);
  return ok(res, info);
}

async function cambiarHotel(req, res) {
  const hotelId = v.idValido((req.body || {}).hotel_id, 'hotel_id');
  const datos = await authService.cambiarHotelActivo(req.usuario, req.session, hotelId);
  return ok(res, datos, 'Hotel activo cambiado');
}

module.exports = { login, logout, sesion, cambiarHotel };
