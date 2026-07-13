# 08 · Despliegue en la nube (para pruebas)

## ⚠️ Por qué NO InfinityFree

InfinityFree es hosting **solo PHP + MySQL**: no puede ejecutar Node.js, y este sistema es Node 22 + Express (el servidor es un proceso que corre permanentemente, no páginas PHP). Subir los archivos ahí simplemente no funcionaría. Abajo hay tres alternativas reales, dos de ellas gratis.

El proyecto ya quedó **listo para cualquiera de las tres**: toda la configuración sale de variables de entorno, el pool soporta TLS (`DB_SSL=1`) y hay un importador de base de datos (`npm run db:importar`).

---

## Paso 0 (común) · Subir el código a GitHub

El repositorio git local ya está inicializado con su primer commit. Solo falta publicarlo:

1. Cree una cuenta en [github.com](https://github.com) (si no tiene).
2. Cree un repositorio **privado** llamado `autohotel-saas` (sin README ni .gitignore, vacío).
3. En la carpeta del proyecto:

```bash
git remote add origin https://github.com/SU-USUARIO/autohotel-saas.git
git push -u origin master
```

El `.gitignore` ya excluye `node_modules/` y `.env` (las contraseñas nunca viajan al repo).

---

## Opción A · Railway (la más simple — recomendada para empezar)

Node y MySQL en la misma plataforma, con red interna. Crédito de prueba gratuito por única vez (~US$5, alcanza ~1 mes de pruebas); después el plan Hobby cuesta US$5/mes.

1. Entre a [railway.com](https://railway.com) → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → elija `autohotel-saas`.
3. En el mismo proyecto: **+ Create → Database → MySQL**.
4. Clic en el servicio de la app → **Variables** → agregue:

| Variable | Valor |
|---|---|
| `DB_HOST` | `${{MySQL.MYSQLHOST}}` |
| `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
| `DB_USER` | `${{MySQL.MYSQLUSER}}` |
| `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
| `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` |
| `DB_SSL` | `0` (red interna privada) |
| `NODE_ENV` | `production` |
| `SESSION_SECRET` | una cadena aleatoria larga (¡nueva, no la del ejemplo!) |

   (`PORT` lo inyecta Railway solo; la app ya lo lee.)
5. **Settings → Networking → Generate Domain** → esa es su URL pública `https://…up.railway.app`.
6. **Importar la base**: clic en el servicio MySQL → pestaña **Connect** → copie las credenciales *públicas* (host `…proxy.rlwy.net`, puerto, usuario, contraseña, base `railway`). En su PC, edite temporalmente el `.env` con esos valores y corra:

```bash
npm run db:importar -- --confirmar
```

   Al terminar (debe decir "13 tablas, 7 usuarios"), **restaure su `.env` local**.

---

## Opción B · Render + Aiven (gratis permanente, para demos)

- **Base de datos**: cuenta en [aiven.io](https://aiven.io) → servicio **MySQL** plan *Free*. Copie host, puerto, usuario, contraseña y base (`defaultdb`), y descargue el certificado **CA** (`ca.pem`).
- **App**: cuenta en [render.com](https://render.com) → **New → Web Service** → conecte el repo. Runtime Node, build `npm install`, start `npm start`, plan **Free**.
- **Variables en Render**: las mismas de la tabla de arriba pero con los datos de Aiven, además `DB_SSL=1` y `DB_SSL_CA` = el contenido completo del `ca.pem` (péguelo tal cual; la app acepta saltos de línea reales o escritos como `\n`).
- **Importar la base**: igual que en Railway — `.env` temporal en su PC con los datos de Aiven **más `DB_SSL=1` y `DB_SSL_CA`**, y `npm run db:importar -- --confirmar`.
- Limitación del plan gratuito de Render: la app **se duerme** tras ~15 min sin visitas y el primer acceso tarda ~1 minuto en despertar. Para demos está bien; para operación real, no.

---

## Opción C · Demo inmediata sin nube (túnel desde su PC)

Si solo quiere que alguien pruebe el sistema HOY, sin cuentas nuevas: con XAMPP y `npm start` corriendo, instale [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) y ejecute:

```bash
cloudflared tunnel --url http://localhost:3000
```

Le da una URL pública `https://…trycloudflare.com` que apunta a su PC. Gratis y sin registro. Limitaciones: solo funciona mientras su PC esté encendida y la URL cambia en cada arranque.

---

## Lista de verificación final

- [ ] `SESSION_SECRET` nuevo y aleatorio (nunca el del `.env.example`).
- [ ] `NODE_ENV=production` en la nube (activa cookies seguras + HSTS; Railway y Render ya dan HTTPS).
- [ ] Base importada: la salida debe decir **13 tablas, 7 usuarios de prueba**.
- [ ] Entrar con `admin/admin123` y verificar el panel.
- [ ] **Importante**: el seed trae credenciales de prueba conocidas (`admin/admin123`, etc.). Si la URL se comparte fuera de su círculo, cambie las contraseñas de los dueños/trabajadores desde el panel y no publique la URL en sitios abiertos.

## Notas técnicas

- Las sesiones viven en MySQL (tabla `sesiones`, se crea sola), así que la app puede reiniciarse sin cerrar las sesiones de los usuarios.
- `bcrypt` es un módulo nativo: Railway/Render lo compilan solos durante el build (no requiere nada extra).
- La zona horaria del negocio (GMT-6) la calcula Node, no MySQL, así que la base puede estar en cualquier región sin afectar los cobros.
