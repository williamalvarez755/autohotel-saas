# 03 · API

> Este documento es la referencia completa de endpoints. La copia extendida con ejemplos de petición/respuesta vive en [`../API.md`](../API.md); aquí se resume por módulo con parámetros y errores.

Base: `/api` · Respuesta SIEMPRE `{ success, message, data }` · Autenticación por cookie de sesión.

Acceso: **[S]** superadmin · **[D]** dueño · **[T]** trabajador · **[P]** público.

## Auth (`controllers/authController.js`)
| Método y ruta | Acceso | Parámetros | Errores relevantes |
|---|---|---|---|
| POST `/auth/login` | [P] | body: `usuario`, `password` | 401 credenciales · 403 desactivado · 403 suspendido · 429 intentos |
| POST `/auth/logout` | sesión | — | — |
| GET `/auth/sesion` | [S][D][T] | — | 401 |
| POST `/auth/hotel-activo` | [D] | body: `hotel_id` | 403 hotel ajeno/inactivo |

## Habitaciones y limpieza (`habitacionesController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| GET `/habitaciones` | [D][T] | — (incluye el menú `tarifas` de cada habitación) | — |
| GET `/habitaciones/admin` | [D] | — (incluye `tarifas`) | — |
| POST `/habitaciones` | [D] | `nombre`, `precio_noche`, `precio_hora_extra`, `tarifas` [{nombre, horas 1–24, precio}] (1–8, nombres únicos) | 400 nombre duplicado / tarifas inválidas |
| PUT `/habitaciones/:id` | [D] | + `activo` (reemplaza el menú de tarifas completo) | 404 ajena · 400 ocupada/reservas al desactivar |
| PUT `/habitaciones/:id/estado` | [D][T] | `estado`: disponible\|limpieza | 400 estancia activa |
| GET `/limpieza` | [D][T] | — | — |
| POST `/habitaciones/:id/limpia` | [D][T] | — | 400 no está en limpieza |

## Estancias (`estanciasController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| POST `/estancias` | [D][T] | `habitacion_id`, `placa`, `tipo` horas\|noche, `tarifa_id` (obligatoria si horas; debe ser de ESA habitación), `reserva_id?` | 404 habitación/reserva/tarifa ajena · 400 no disponible / reservada sin reserva |
| POST `/estancias/:id/pago-base` | [D][T] | `metodo`, `efectivo_recibido` si efectivo | 400 ya pagado / efectivo insuficiente · 404 |
| GET `/estancias/activas` | [D][T] | — (incluye `tarifa_nombre` y `precio_hora_extra` fotografiados) | — |
| GET `/estancias/:id` | [D][T] | — | 404 |
| GET `/estancias/:id/pre-salida` | [D][T] | — | 400 ya finalizada · 404 |
| POST `/estancias/:id/salida` | [D][T] | `metodo?`, `efectivo_recibido?` (obligatorios si hay pendiente) | 400 falta método / efectivo insuficiente |

## Pedidos (`pedidosController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| GET `/estancias/:id/pedidos` | [D][T] | — | 404 |
| POST `/estancias/:id/pedidos` | [D][T] | `producto_id`, `cantidad` (1–999) | 400 **stock insuficiente** · 404 estancia/producto |

## Inventario (`productosController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| GET `/productos` | [D][T] | dueño: `?todos=1` | — |
| POST `/productos` | [D][T] | `nombre`, `precio?` (trabajador puede omitir → 0), `stock`, `stock_minimo?` | 400 nombre duplicado |
| PUT `/productos/:id` | [D] | `nombre`, `precio`, `stock_minimo`, `activo` | 404 · 400 duplicado |
| POST `/productos/:id/entrada` | [D][T] | `cantidad` ≥1, `motivo?` | 404 |
| POST `/productos/:id/ajuste` | [D] | `direccion` sumar\|restar, `cantidad`, `motivo` (obligatorio) | 400 quedaría negativo |
| GET `/productos/movimientos` | [D] | `?producto_id=` | — |

## Reservas (`reservasController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| GET `/reservas` | [D][T] | — | — |
| POST `/reservas` | [D][T] | `habitacion_id`, `fecha_hora` 'AAAA-MM-DD HH:MM', `placa?`, `nota?` | 400 no disponible / fecha pasada |
| POST `/reservas/:id/cancelar` | [D][T] | — | 404 ya resuelta |

## Alertas / Dashboard / Reportes
| Método y ruta | Acceso | Parámetros |
|---|---|---|
| GET `/alertas` | [D][T] | — |
| GET `/dashboard` | [D] | — |
| GET `/reportes/ingresos-dia` | [D] | `desde`, `hasta` (AAAA-MM-DD, ≤366 días) |
| GET `/reportes/ingresos-habitacion` | [D] | + `habitacion_id?` |
| GET `/reportes/productos-vendidos` | [D] | `desde`, `hasta` |
| GET `/reportes/estancias` | [D] | + `habitacion_id?` |

## Usuarios del dueño (`usuariosController`)
| Método y ruta | Acceso | Parámetros | Errores |
|---|---|---|---|
| GET `/usuarios` | [D] | — | — |
| POST `/usuarios` | [D] | `nombre`, `usuario`, `password` (≥6), `hotel_id` | 400 usuario en uso · 403 hotel ajeno |
| PUT `/usuarios/:id` | [D] | `nombre`, `hotel_id`, `password?` | 404 trabajador ajeno |
| PUT `/usuarios/:id/activo` | [D] | `activo` 0\|1 | 404 |

## Superadmin (`superadminController`)
| Método y ruta | Parámetros | Notas |
|---|---|---|
| GET `/superadmin/duenos` | — | incluye `estado_calculado` y hoteles |
| POST `/superadmin/duenos` | `nombre`, `usuario`, `password`, `fecha_vencimiento?` | default: hoy+1 mes |
| PUT `/superadmin/duenos/:id` | `nombre`, `password?` | |
| POST `/superadmin/duenos/:id/suspender` · `/reactivar` | — | reactivar no quita el vencimiento |
| POST `/superadmin/duenos/:id/pagos` | `monto` >0, `mes_correspondiente?` 'AAAA-MM', `nota?` | extiende +1 mes y reactiva |
| GET `/superadmin/duenos/:id/pagos` | — | historial |
| POST `/superadmin/hoteles` | `dueno_id`, `nombre`, `direccion?`, `minutos_alerta_limpieza?`, `horas_noche?` | |
| PUT `/superadmin/hoteles/:id` | + `activo` | |

## Postman / curl rápido

```bash
# Login y guardar cookie
curl -c cookies.txt -H "Content-Type: application/json" \
  -d '{"usuario":"pedro","password":"trab123"}' http://localhost:3000/api/auth/login

# Tablero (cada habitación trae su menú de tarifas: [{id, nombre, horas, precio}])
curl -b cookies.txt http://localhost:3000/api/habitaciones

# Entrada con tarifa + cobro (tarifa_id sale del menú de la habitación)
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"habitacion_id":1,"placa":"P-123","tipo":"horas","tarifa_id":1}' http://localhost:3000/api/estancias
curl -b cookies.txt -H "Content-Type: application/json" \
  -d '{"metodo":"efectivo","efectivo_recibido":200}' http://localhost:3000/api/estancias/1/pago-base
```
