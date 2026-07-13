// ============================================================
// Controlador de usuarios del dueño (sus trabajadores).
// ============================================================

const usuariosService = require('../services/usuariosService');
const { ok } = require('../utils/respuesta');
const v = require('../utils/validacion');

async function listar(req, res) {
  const datos = await usuariosService.listar(req.usuario.id);
  return ok(res, datos);
}

async function crear(req, res) {
  const cuerpo = req.body || {};
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    usuario: v.nombreUsuario(cuerpo.usuario),
    password: v.contrasena(cuerpo.password),
    hotel_id: v.idValido(cuerpo.hotel_id, 'hotel_id')
  };
  const resultado = await usuariosService.crear(req.usuario.id, datos);
  return ok(res, resultado, 'Trabajador creado');
}

async function editar(req, res) {
  const id = v.idValido(req.params.id);
  const cuerpo = req.body || {};
  const datos = {
    nombre: v.textoRequerido(cuerpo.nombre, 'nombre', 100),
    hotel_id: v.idValido(cuerpo.hotel_id, 'hotel_id'),
    password: cuerpo.password ? v.contrasena(cuerpo.password) : null
  };
  const resultado = await usuariosService.editar(req.usuario.id, id, datos);
  return ok(res, resultado, 'Trabajador actualizado');
}

async function cambiarActivo(req, res) {
  const id = v.idValido(req.params.id);
  const activo = v.booleano((req.body || {}).activo, 'activo');
  const resultado = await usuariosService.cambiarActivo(req.usuario.id, id, activo);
  return ok(res, resultado, activo ? 'Trabajador reactivado' : 'Trabajador desactivado');
}

module.exports = { listar, crear, editar, cambiarActivo };
