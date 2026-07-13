// ============================================================
// Endurecimiento de peticiones mutantes (defensa en profundidad
// contra CSRF, complementa SameSite=Lax + API solo-JSON):
// toda petición que modifica estado (POST/PUT/PATCH/DELETE) debe
// venir del MISMO origen. Se validan dos señales del navegador:
//   - Origin: si viene, su host debe coincidir con el Host servido.
//   - Sec-Fetch-Site: si viene, debe ser same-origin/same-site/none.
// Los clientes sin navegador (curl, pruebas e2e) no envían estas
// cabeceras y pasan; un navegador moderno siempre las envía en
// peticiones cross-site, que es el vector que se quiere cortar.
// ============================================================

const { fallo } = require('../utils/respuesta');

const METODOS_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);
const SEC_FETCH_PERMITIDOS = new Set(['same-origin', 'same-site', 'none']);

function verificarOrigen(req, res, next) {
  if (METODOS_LECTURA.has(req.method)) return next();

  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && !SEC_FETCH_PERMITIDOS.has(secFetchSite)) {
    return fallo(res, 403, 'Petición de origen cruzado rechazada');
  }

  const origen = req.headers.origin;
  if (origen) {
    let hostOrigen;
    try {
      hostOrigen = new URL(origen).host;
    } catch {
      return fallo(res, 403, 'Petición de origen cruzado rechazada');
    }
    if (hostOrigen !== req.headers.host) {
      return fallo(res, 403, 'Petición de origen cruzado rechazada');
    }
  }
  return next();
}

module.exports = { verificarOrigen };
