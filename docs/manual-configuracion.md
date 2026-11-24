# Manual de configuración — Gestor de claves

Este manual explica cómo poner en marcha el servicio, administrarlo y conectar tus aplicaciones. La última sección está pensada para tus usuarios finales.

## Índice

1. [Cómo funciona](#1-cómo-funciona)
2. [Requisitos](#2-requisitos)
3. [Servidor recomendado](#3-servidor-recomendado)
4. [Primera puesta en marcha](#4-primera-puesta-en-marcha)
5. [Panel de administración (local)](#5-panel-de-administración-local)
6. [Uso diario del panel](#6-uso-diario-del-panel)
7. [Integrar tus aplicaciones](#7-integrar-tus-aplicaciones)
8. [Lo que esta protección no cubre](#8-lo-que-esta-protección-no-cubre)
9. [Operación y mantenimiento](#9-operación-y-mantenimiento)
10. [Lista de comprobación de seguridad](#10-lista-de-comprobación-de-seguridad)
11. [Para el usuario final](#11-para-el-usuario-final)
12. [Publicar gratis en Render y Supabase](#12-publicar-gratis-en-render-y-supabase)

---

## 1. Cómo funciona

```
 TU PC (nunca publicado)                    SERVIDOR (publicado)
 ┌───────────────────────┐   túnel SSH   ┌──────────────────────────────┐
 │ Panel  127.0.0.1:4000 │──────────────▶│ PostgreSQL (solo localhost)  │
 │ (usuario dueño de BD) │               │        ▲                     │
 └───────────────────────┘               │        │ usuario gk_api      │
                                         │ API  127.0.0.1:3000          │
                                         │        ▲                     │
                                         │ Caddy :443 (HTTPS)           │
                                         └────────┼─────────────────────┘
                                                  │ POST /v1/verify
                        ┌─────────────────────────┴──────────────────┐
                        │ Tus apps: Flutter, .NET, Express, NestJS,  │
                        │ Next.js, Angular                           │
                        └────────────────────────────────────────────┘
```

1. En el panel registras cada **app** (nombre, URL, `app_id`). Se genera su **clave de aplicación** (`gkapp_…`), que va dentro de la app.
2. En el panel generas **claves de usuario** (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`) para esa app, con un máximo de dispositivos (1 por defecto).
3. El usuario abre la app y escribe su clave. La app llama a `POST /v1/verify` con la clave, su `app_id` y el ID del dispositivo.
4. El servidor comprueba todo y registra el dispositivo si hay cupo, guardando también su IP. Después devuelve un **token firmado** válido 7 días.
5. La app guarda el token y lo comprueba sin conexión con la **clave pública** que lleva incrustada. Lo renueva antes de que venza.

Las claves completas (de app y de usuario) solo se ven una vez, al crearlas. En la base de datos solo queda su huella (hash).

## 2. Requisitos

- **En tu PC (Windows):** Node.js 22 o superior (probado con 24), Git y el cliente `ssh` que trae Windows.
- **Un servidor Linux** (VPS) con Ubuntu 24.04 o similar, 1 GB de RAM basta.
- **Un dominio o subdominio** para la API, por ejemplo `licencias.tudominio.com`, apuntando a la IP del servidor.

Instalar las dependencias del proyecto en tu PC (desde la carpeta del proyecto):

```powershell
npm install
```

Comprobar que todo funciona:

```powershell
npm test
```

## 3. Servidor recomendado

La configuración recomendada es la más segura sin coste extra:

- **PostgreSQL** escuchando solo en `localhost` del servidor. Nunca se abre a internet.
- **La API** escuchando solo en `127.0.0.1:3000`.
- **Caddy** delante, en el puerto 443, con HTTPS automático (certificados de Let's Encrypt).
- **Firewall** con solo los puertos 22 (SSH), 80 y 443 abiertos.
- **El panel** corre en tu PC y llega a la base por un **túnel SSH**.

> **Alternativa gratuita:** la API en Render y la base en Supabase. Está explicada paso a paso en la [sección 12](#12-publicar-gratis-en-render-y-supabase).

### 3.1 Preparar el servidor

Conéctate por SSH y ejecuta (en el servidor, bash):

```bash
# Node.js 24
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs git

# PostgreSQL
sudo apt-get install -y postgresql

# Caddy
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Comprueba que PostgreSQL solo escucha en localhost (debe mostrar `127.0.0.1:5432`, no `0.0.0.0:5432`):

```bash
sudo ss -ltnp | grep 5432
```

### 3.2 Crear la base de datos y su usuario dueño

Genera una contraseña larga, por ejemplo con `openssl rand -base64 32`, y sustitúyela abajo:

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE gk_owner LOGIN CREATEROLE PASSWORD 'CAMBIA_ESTA_CONTRASEÑA_LARGA';
CREATE DATABASE gestor OWNER gk_owner;
SQL
```

`gk_owner` es el usuario que usa **solo tu panel**. Lleva `CREATEROLE` para que `npm run db:roles` pueda crear el usuario limitado de la API.

## 4. Primera puesta en marcha

### 4.1 Abrir el túnel hacia la base de datos (en tu PC)

Deja esta ventana abierta mientras trabajes con el panel o con los scripts:

```powershell
ssh -N -L 5433:localhost:5432 usuario@IP_DEL_SERVIDOR
```

Desde tu PC, la base queda disponible en `127.0.0.1:5433`. El tráfico va cifrado por SSH.

### 4.2 Crear el archivo `.env` en tu PC

Copia `.env.example` a `.env` en la raíz del proyecto y rellena:

```
ADMIN_DATABASE_URL=postgres://gk_owner:CONTRASEÑA_DUEÑO@127.0.0.1:5433/gestor
ADMIN_PORT=4000
```

El archivo `.env` está en `.gitignore`: nunca lo subas a ningún repositorio.

### 4.3 Crear las tablas y el usuario de la API (en tu PC)

```powershell
npm run db:migrate
```

```powershell
npm run db:roles
```

`db:roles` crea el usuario `gk_api` con permisos mínimos: puede leer apps y claves, registrar dispositivos y escribir el registro de verificaciones, pero **no puede crear, cambiar ni revocar claves**. Si no defines `API_DB_PASSWORD`, genera una contraseña y la muestra **una sola vez**, junto con la `DATABASE_URL` que necesita la API. Cópiala.

### 4.4 Generar las claves de firma (en tu PC)

```powershell
npm run keys:generate
```

Crea dos archivos en `secrets/`:

- `signing-private.pem`: **solo** va al servidor de la API. Quien la tenga puede fabricar tokens válidos.
- `signing-public.pem`: va **incrustada en cada app** para comprobar los tokens.

También sugiere un `SIGNING_KEY_ID` como `k-20261123`. Guarda una copia de `secrets/` en un lugar seguro, por ejemplo un gestor de contraseñas o un USB cifrado.

### 4.5 Instalar la API en el servidor

En el servidor (bash):

```bash
sudo useradd --system --home /opt/gestor-de-claves --shell /usr/sbin/nologin gestor
sudo git clone <URL_DE_TU_REPOSITORIO> /opt/gestor-de-claves
cd /opt/gestor-de-claves && sudo npm ci
sudo chown -R root:root /opt/gestor-de-claves
sudo mkdir -p /etc/gestor-de-claves
```

Si no usas un repositorio Git, copia la carpeta del proyecto con `scp`, sin `node_modules`, `.env` ni `secrets/`.

Copia la clave privada desde tu PC (PowerShell):

```powershell
scp secrets/signing-private.pem usuario@IP_DEL_SERVIDOR:/tmp/
```

Y en el servidor, protégela:

```bash
sudo mv /tmp/signing-private.pem /etc/gestor-de-claves/
sudo chown gestor:gestor /etc/gestor-de-claves/signing-private.pem
sudo chmod 600 /etc/gestor-de-claves/signing-private.pem
```

Crea `/etc/gestor-de-claves/api.env` (`sudo nano /etc/gestor-de-claves/api.env`):

```
DATABASE_URL=postgres://gk_api:CONTRASEÑA_DE_DB_ROLES@127.0.0.1:5432/gestor
SIGNING_PRIVATE_KEY_FILE=/etc/gestor-de-claves/signing-private.pem
SIGNING_KEY_ID=k-20261123
TOKEN_TTL_DAYS=7
ISSUER=gestor-de-claves
HOST=127.0.0.1
PORT=3000
TRUSTED_IP_HEADER=x-real-ip
```

```bash
sudo chown root:gestor /etc/gestor-de-claves/api.env
sudo chmod 640 /etc/gestor-de-claves/api.env
```

**Variables de la API:**

| Variable | Obligatoria | Qué es |
|---|---|---|
| `DATABASE_URL` | Sí | Conexión con el usuario `gk_api` (nunca con el dueño). |
| `SIGNING_PRIVATE_KEY_FILE` | Una de las dos | Ruta al `.pem` privado. Recomendado. |
| `SIGNING_PRIVATE_KEY` | Una de las dos | El PEM en la propia variable, con `\n` en lugar de saltos de línea. Útil en plataformas sin archivos. |
| `SIGNING_KEY_ID` | Sí | Identificador de la clave de firma (va en la cabecera `kid` del token). |
| `TOKEN_TTL_DAYS` | No (7) | Días de vida del token. Menos días = la revocación se nota antes, pero la app necesita conexión más a menudo. |
| `ISSUER` | No (`gestor-de-claves`) | Emisor del token. Las apps deben comprobar el mismo valor. |
| `HOST` | No (`127.0.0.1`) | Interfaz donde escucha. Déjalo en `127.0.0.1` detrás de Caddy. |
| `PORT` | No (3000) | Puerto de la API. |
| `TRUSTED_IP_HEADER` | No | Cabecera de la que tomar la IP real del cliente. Con la configuración de Caddy de abajo: `x-real-ip`. Déjala vacía si la API no está detrás de un proxy. |

Si falta algo, la API no arranca y dice qué variable revisar.

### 4.6 Servicio systemd

Crea `/etc/systemd/system/gestor-api.service`:

```ini
[Unit]
Description=Gestor de claves - API
After=network.target postgresql.service

[Service]
User=gestor
Group=gestor
WorkingDirectory=/opt/gestor-de-claves
EnvironmentFile=/etc/gestor-de-claves/api.env
ExecStart=/usr/bin/node --import tsx apps/api/src/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadOnlyPaths=/opt/gestor-de-claves /etc/gestor-de-claves

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now gestor-api
sudo systemctl status gestor-api
```

### 4.7 HTTPS con Caddy

Edita `/etc/caddy/Caddyfile`:

```
licencias.tudominio.com {
	reverse_proxy 127.0.0.1:3000 {
		header_up X-Real-IP {remote_host}
	}
}
```

```bash
sudo systemctl reload caddy
```

`header_up X-Real-IP {remote_host}` sustituye cualquier valor que mande el cliente por su IP real, así que no se puede falsificar.

### 4.8 Comprobar

Desde tu PC:

```powershell
curl.exe https://licencias.tudominio.com/health
```

Debe responder `{"ok":true}`.

### 4.9 Probar la API en tu PC (opcional)

Para probar tus apps contra una API local, descomenta las variables de la API en tu `.env`. La `DATABASE_URL` debe usar el usuario `gk_api` y el puerto del túnel (`5433`), y `SIGNING_PRIVATE_KEY_FILE` debe ser una ruta absoluta. Después:

```powershell
npm run api
```

La API queda en `http://127.0.0.1:3000`.

## 5. Panel de administración (local)

1. Abre el túnel SSH (sección 4.1).
2. Arranca el panel:

```powershell
npm run admin
```

3. Abre `http://127.0.0.1:4000` en el navegador.

Para cerrarlo, pulsa Ctrl+C en la terminal.

**Variables del panel (en `.env`):**

| Variable | Obligatoria | Qué es |
|---|---|---|
| `ADMIN_DATABASE_URL` | Sí | Conexión con el usuario dueño (`gk_owner`) a través del túnel. |
| `ADMIN_PORT` | No (4000) | Puerto local del panel. |

**Protecciones del panel:** escucha solo en `127.0.0.1` y no es accesible desde la red. Rechaza peticiones cuyo `Host` no sea `127.0.0.1` o `localhost`, lo que bloquea el *DNS rebinding*. Rechaza formularios enviados desde otras webs (CSRF). No guarda nada en caché del navegador y no ejecuta JavaScript. Quien tenga acceso a tu PC y a tu `.env` tiene control total, así que protege tu sesión de Windows.

## 6. Uso diario del panel

### Registrar una app

En la página principal, **Registrar app**:

- **Identificador (app_id):** minúsculas, números y guiones, por ejemplo `mi-app-flutter`. Es lo que la app envía como `app_id`.
- **Nombre:** para ti.
- **URL:** la web o página de la app. Para apps web (Angular, Next.js en el navegador) es además el **único origen** desde el que el navegador puede llamar a la API (CORS).

Al registrarla verás la **clave de aplicación** (`gkapp_…`) **una sola vez**. Cópiala y ponla en la configuración de la app. La página de la app muestra la fecha en que la registraste.

### Generar una clave de usuario

Entra en la app y rellena **Generar clave**:

- **Etiqueta:** el cliente o el uso, por ejemplo «Ferretería López».
- **Máximo de dispositivos:** 1 por defecto. Con 1, la clave queda atada al primer dispositivo que la use.
- **Vence el:** opcional. La clave deja de validar al terminar ese día (hora de tu PC). Vacío = nunca vence.
- **Días de uso por dispositivo desde su activación:** opcional. Con `7`, cada dispositivo puede usar la app 7 días contados desde que se activa. Sirve para **licencias de prueba**: das la clave hoy y la prueba empieza cuando el usuario la introduce. Vacío = sin límite.

Si pones las dos fechas, manda **la que llegue antes**. Sin ninguna, la licencia funciona para siempre.

La clave completa se muestra **una sola vez**. Entrégala al cliente por un canal privado.

### Ver y gestionar dispositivos

En la página de una clave ves cada dispositivo con su ID, nombre, plataforma, versión, IP (primera y última), la fecha en que se registró con la clave, su último uso, las **horas de uso** que informa la app y su **fecha de vencimiento**.

- **El usuario cambia de móvil o de PC:** pulsa **Quitar** en el dispositivo viejo. El cupo queda libre y el nuevo podrá registrarse. Si el viejo vuelve a activarse, conserva su fecha de vencimiento: quitar y volver a activar no reinicia una prueba.
- **Cambiar o quitar el vencimiento de un dispositivo:** en su fila, elige otra fecha y pulsa **Guardar**. Para que no venza nunca, borra la fecha y pulsa **Guardar**.
- **Cambiar o quitar el vencimiento de la clave:** formulario **Vencimiento de la clave**. Ahí también cambias los días por dispositivo; el cambio se aplica a los dispositivos que se activen a partir de entonces.
- **Permitir más dispositivos:** cambia el **máximo de dispositivos**.
- **Revocar la clave:** marca la casilla y pulsa **Revocar clave**. Las apps no podrán renovar. Un dispositivo con un token ya emitido sigue funcionando hasta que ese token venza (hasta 7 días más 3 de gracia).

**Los vencimientos sí son exactos:** el token nunca dura más que la licencia, y la app deja de funcionar a la hora de vencimiento aunque no tenga internet. Si **alargas** una fecha, la app lo recoge la próxima vez que se conecte. Si la **acortas**, un dispositivo que ya tenga token puede seguir hasta la fecha anterior o, como mucho, 7 días, igual que una revocación.

### Registro de verificaciones

Cada verificación deja una fila: fecha, app, clave, dispositivo, IP, resultado y horas de uso. Para que no crezca sin límite (importante en planes gratuitos con poco espacio), entra en **Registro de verificaciones**, arriba a la derecha:

1. Elige un día y pulsa **Descargar CSV**. Se descarga todo lo registrado hasta ese día, incluido. El archivo se abre en Excel con columnas y tildes; las fechas van en la hora de tu PC.
2. Comprueba el archivo. Después, en **Borrar**, pon **el mismo día**, marca la casilla y pulsa **Borrar registros**. El panel dice cuántas filas borró.

El día debe ser anterior a hoy: las filas recientes las usa el límite de intentos. El borrado no se puede deshacer, salvo desde una copia de seguridad de la base.

### Renovar la clave de aplicación

Si crees que una clave `gkapp_…` se ha filtrado, usa **Renovar clave de aplicación** en la página de la app. La anterior sigue valiendo **30 días** para que publiques la actualización de la app.

### Desactivar una app

**Desactivar app** hace fallar todas sus verificaciones (`invalid_client`). Se puede reactivar.

## 7. Integrar tus aplicaciones

### 7.1 Contrato de la API

**Petición**

```
POST https://licencias.tudominio.com/v1/verify
Content-Type: application/json
X-App-Key: gkapp_…

{
  "app_id": "mi-app",
  "license_key": "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX",
  "device_id": "un-id-estable-del-dispositivo",
  "device_name": "Portátil de Ana",     (opcional, se recorta a 100)
  "platform": "android",                (opcional, se recorta a 50)
  "app_version": "1.4.2",               (opcional, se recorta a 30)
  "usage_seconds": 5400                 (opcional, entero ≥ 0)
}
```

- `license_key`: el servidor acepta minúsculas, espacios, sin guiones, y `O`, `I` o `L` en lugar de `0` y `1`.
- `device_id`: 8 a 128 caracteres de `A-Z a-z 0-9 . _ : -`. Un UUID sirve.
- `usage_seconds`: el **total** de segundos que se ha usado la app desde que se instaló (no lo usado desde la última vez). Así, si una petición se repite por un corte de red, no se cuenta dos veces. Lo calcula tu app; el servidor guarda el último valor.
- Los campos opcionales nunca hacen fallar la verificación: un texto demasiado largo se recorta y un valor de tipo incorrecto se ignora. Si no envías un campo, se conserva el valor guardado.
- Cuerpo máximo: 4 KB.

**Respuestas**

Todas las respuestas de error traen `error` (el código, para tu programa) y `message` (el motivo en español, para mostrárselo al usuario). Por ejemplo:

```json
{ "ok": false, "error": "device_expired", "expires_at": "2026-12-01T22:59:59.000Z",
  "message": "El periodo de uso de esta licencia en este dispositivo terminó." }
```

| HTTP | `error` | Significado | Qué debe hacer la app |
|---|---|---|---|
| 200 | — | `{ "ok": true, "token": "…", "expires_at": "…", "license_expires_at": "…" o null }` | Verificar el token y guardarlo junto con la clave. `license_expires_at` es cuándo vence la licencia en este dispositivo (`null` = nunca); puedes mostrarlo. |
| 400 | `bad_request` | Faltan campos obligatorios o tienen mal formato. | Error de programación: revisar la llamada. |
| 401 | `invalid_client` | `X-App-Key` incorrecta o app desactivada. | Mostrar el mensaje; no pedir otra clave al usuario. |
| 403 | `invalid_key` | La clave no existe o no es de esta app. | Pedir la clave de nuevo. |
| 403 | `key_revoked` | Clave revocada. | Borrar lo guardado, mostrar el mensaje y bloquear. |
| 403 | `key_expired` | Clave vencida; trae `expires_at`. | Borrar lo guardado, mostrar el mensaje y bloquear. |
| 403 | `device_expired` | Venció el plazo de este dispositivo; trae `expires_at`. | Borrar lo guardado, mostrar el mensaje y bloquear. |
| 403 | `device_limit_reached` | Sin cupo; trae `max_devices`. | Mostrar el mensaje: la clave está en uso en otro dispositivo. |
| 413 | `payload_too_large` | Cuerpo de más de 4 KB. | Error de programación. |
| 429 | `rate_limited` | Más de 30 peticiones por minuto o más de 10 fallos en 15 minutos desde esa IP. Trae `Retry-After: 60`. | Esperar y reintentar; si hay token válido, seguir. |
| 500 | `server_error` | Fallo interno. | Tratarlo como falta de red. |

Las fechas (`expires_at`, `license_expires_at`) van en UTC; muéstralas en la hora local del dispositivo.

**El token** es un JWT firmado con **ES256**. Lleva la cabecera `kid` y estos campos:

- `iss`: igual a `ISSUER`.
- `aud`: el `app_id`.
- `sub`: el id interno de la clave, que no es la clave.
- `device_id`, `iat` y `exp`.
- `lic_exp`: solo si la licencia vence. Es el instante de vencimiento, en segundos desde 1970. El `exp` del token nunca es posterior.

### 7.2 Reglas para todas las apps

1. Incrusta en la app la **clave pública** (`signing-public.pem`), el `app_id`, la clave de aplicación y la URL de la API. **Nunca descargues la clave pública del servidor**: un servidor falso podría darte la suya.
2. Al verificar el token, comprueba la firma ES256, `iss`, `aud` igual a tu `app_id`, y `device_id` igual al tuyo. Comprueba también `exp` con **3 días de gracia**.
3. Si el token trae `lic_exp` y ya pasó, el token **no vale**, sin gracia y aunque no haya red. La gracia es para cortes de conexión, no para alargar una prueba.
4. Si al token le quedan **menos de 2 días**, renuévalo llamando de nuevo a `/v1/verify` con la clave guardada. Si no hay red, sigue con el actual. Excepción: si `exp` ya es igual o posterior a `lic_exp`, renovar no lo alargaría; no renueves en cada arranque y espera a que venza.
5. Si el token no es válido, revalida con la clave guardada (así recoges una prórroga que hayas dado en el panel). Si el servidor la rechaza (403), borra lo guardado, muestra `message` y pide la clave al usuario.
6. Genera el `device_id` **una vez** (un UUID aleatorio) y guárdalo de forma persistente. Si la app lo pierde, contará como un dispositivo nuevo.
7. Guarda la clave del usuario en almacenamiento seguro cuando la plataforma lo tenga.
8. Si quieres horas de uso, acumula en tu app los segundos que está abierta (guardándolos de forma persistente) y envía el total en `usage_seconds`. Llegan al servidor cuando la app renueva, no en tiempo real. Lo calcula el dispositivo, así que tómalo como estadística, no como prueba. Si lo recoges, menciónalo en la política de privacidad de tu app.

### 7.3 Node.js: Express, NestJS y el servidor de Next.js

Usa [`examples/node-client.ts`](../examples/node-client.ts), que está probado en este repositorio. Copia el archivo a tu proyecto e instala `jose`:

```powershell
npm install jose
```

En apps de servidor, el «dispositivo» es la instalación del servidor y la clave viene de una variable de entorno:

```ts
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { checkLicense } from "./node-client";

const DEVICE_FILE = "./data/device-id";
function deviceId(): string {
  if (existsSync(DEVICE_FILE)) return readFileSync(DEVICE_FILE, "utf8").trim();
  const id = randomUUID();
  writeFileSync(DEVICE_FILE, id);
  return id;
}

export const licenseOptions = {
  apiUrl: "https://licencias.tudominio.com",
  appSlug: "mi-api-express",
  appKey: process.env.GK_APP_KEY!,           // gkapp_…
  publicKeyPem: readFileSync("./signing-public.pem", "utf8"),
  issuer: "gestor-de-claves",
  storePath: "./data/license.json",
  deviceId: deviceId(),
  askLicenseKey: async () => process.env.LICENSE_KEY ?? "",
  appVersion: "1.4.2",
  // Opcional: total de segundos de uso desde la instalación, que tu app guarda y acumula.
  // usageSeconds: () => miContadorDeUso(),
};
```

**Express:** comprueba al arrancar y cada 12 horas.

```ts
let licensed = false;
async function refresh() {
  const r = await checkLicense(licenseOptions);
  licensed = r.ok;
  if (!r.ok) console.error(`Licencia no válida (${r.error}): ${r.message}`);
}
await refresh();
setInterval(refresh, 12 * 60 * 60 * 1000).unref();

app.use((req, res, next) => (licensed ? next() : res.status(403).json({ error: "licencia_no_valida" })));
```

**NestJS:** haz la misma comprobación en `onApplicationBootstrap()` de un servicio `LicenseService` y usa un `Guard` global que devuelva `false` si `licensed` es `false`.

**Next.js:** valida en el servidor, nunca solo en el navegador. Llama a `checkLicense` en `instrumentation.ts` (`register()`) y guarda el resultado en un módulo. En `middleware.ts` o en tus Route Handlers, responde 403 si no hay licencia.

### 7.4 Apps web (Angular, React, Vue…)

Usa [`examples/web/license.ts`](../examples/web/license.ts), probado contra la API en este repositorio (`examples/web/license.test.ts`). La guía paso a paso, con el guard de Angular, un componente de React y las reglas de CORS, está en el [manual de apps, sección 4](manual-apps.md#4-web-angular-react-vue).

> Todo el código del navegador lo puede leer y modificar el usuario. Esta comprobación disuade, pero no protege de verdad. La protección real está en tu backend.

La URL registrada de la app en el panel debe ser exactamente el origen del sitio, por ejemplo `https://app.tudominio.com`. Si no, el navegador bloqueará la llamada (CORS).

### 7.5 Flutter

Usa los archivos de [`examples/flutter/lib/license/`](../examples/flutter/lib/license), probados contra la API con Flutter (Dart 3.13), `dart_jsonwebtoken` 3.4 y `flutter_secure_storage` 11.2. La guía paso a paso (dependencias, `LicenseGate`, permiso de internet en Android, compilación con `--dart-define`) está en el [manual de apps, sección 3](manual-apps.md#3-flutter-android-e-ios).

### 7.6 .NET

> **No probado en este repositorio.**

```powershell
dotnet add package Microsoft.IdentityModel.JsonWebTokens
```

```csharp
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

public sealed class License
{
    const string Api = "https://licencias.tudominio.com";
    const string AppId = "mi-app-dotnet";
    const string AppKey = "gkapp_…";
    const string Issuer = "gestor-de-claves";
    const string PublicKeyPem = """
        -----BEGIN PUBLIC KEY-----
        …contenido de signing-public.pem…
        -----END PUBLIC KEY-----
        """;
    static readonly TimeSpan Grace = TimeSpan.FromDays(3);
    static readonly TimeSpan RenewBefore = TimeSpan.FromDays(2);

    static readonly string Dir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MiApp");
    static readonly string DeviceFile = Path.Combine(Dir, "device-id");
    static readonly string LicenseFile = Path.Combine(Dir, "license.bin");
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(60) }; // Render gratis tarda en despertar

    static string DeviceId()
    {
        Directory.CreateDirectory(Dir);
        if (File.Exists(DeviceFile)) return File.ReadAllText(DeviceFile).Trim();
        var id = Guid.NewGuid().ToString();
        File.WriteAllText(DeviceFile, id);
        return id;
    }

    /// Último motivo de rechazo, para mostrarlo al usuario.
    public static string LastMessage { get; private set; } = "";

    /// null si el token no vale; si vale, el tiempo restante y si ya llega al vencimiento de la licencia.
    static async Task<(TimeSpan Left, bool ReachesEnd)?> TokenState(string token)
    {
        var ecdsa = ECDsa.Create();
        ecdsa.ImportFromPem(PublicKeyPem);
        var result = await new JsonWebTokenHandler().ValidateTokenAsync(token, new TokenValidationParameters
        {
            ValidIssuer = Issuer,
            ValidAudience = AppId,
            IssuerSigningKey = new ECDsaSecurityKey(ecdsa),
            ValidAlgorithms = new[] { SecurityAlgorithms.EcdsaSha256 },
            ClockSkew = Grace,
        });
        if (!result.IsValid) return null;
        var jwt = (JsonWebToken)result.SecurityToken;
        if (!jwt.TryGetPayloadValue<string>("device_id", out var dev) || dev != DeviceId()) return null;
        var now = DateTimeOffset.UtcNow;
        long? licExp = jwt.TryGetPayloadValue<long>("lic_exp", out var l) ? l : null;
        // Licencia vencida: sin gracia, aunque no haya red.
        if (licExp is { } le && now.ToUnixTimeSeconds() >= le) return null;
        var exp = new DateTimeOffset(jwt.ValidTo, TimeSpan.Zero);
        return (exp - now, licExp is { } le2 && exp.ToUnixTimeSeconds() >= le2);
    }

    // En Windows, la clave guardada se cifra con DPAPI (ligada al usuario de Windows).
    static void Save(string licenseKey, string token) =>
        File.WriteAllBytes(LicenseFile, ProtectedData.Protect(
            JsonSerializer.SerializeToUtf8Bytes(new[] { licenseKey, token }), null, DataProtectionScope.CurrentUser));

    static string[]? Load()
    {
        try
        {
            return JsonSerializer.Deserialize<string[]>(ProtectedData.Unprotect(
                File.ReadAllBytes(LicenseFile), null, DataProtectionScope.CurrentUser));
        }
        catch { return null; }
    }

    /// null si va bien; si no, el código de error (el motivo queda en LastMessage).
    /// usageSeconds: total de segundos de uso desde la instalación, si llevas la cuenta.
    public static async Task<string?> Activate(string licenseKey, long? usageSeconds = null)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Post, $"{Api}/v1/verify")
            {
                Content = JsonContent.Create(new
                {
                    app_id = AppId, license_key = licenseKey, device_id = DeviceId(),
                    platform = "dotnet", device_name = Environment.MachineName,
                    app_version = typeof(License).Assembly.GetName().Version?.ToString(),
                    usage_seconds = usageSeconds,
                }),
            };
            req.Headers.Add("X-App-Key", AppKey);
            var res = await Http.SendAsync(req);
            var data = await res.Content.ReadFromJsonAsync<JsonElement>();
            if (!data.GetProperty("ok").GetBoolean())
            {
                LastMessage = data.TryGetProperty("message", out var m) ? m.GetString()! : "No se pudo verificar la licencia.";
                return data.TryGetProperty("error", out var e) ? e.GetString() : "unknown_error";
            }
            var token = data.GetProperty("token").GetString()!;
            if (await TokenState(token) is null) return "invalid_token";
            Save(licenseKey, token);
            return null;
        }
        catch
        {
            LastMessage = "No se pudo conectar con el servidor de licencias. Revisa tu conexión.";
            return "network_error";
        }
    }

    /// true si la app puede seguir; si es false, muestra LastMessage, pide la clave y llama a Activate.
    public static async Task<bool> Check(long? usageSeconds = null)
    {
        var saved = Load();
        if (saved is null) return false;
        var state = await TokenState(saved[1]);
        if (state is { } s && (s.Left > RenewBefore || s.ReachesEnd)) return true;
        var err = await Activate(saved[0], usageSeconds);
        if (err is null || (state is not null && err == "network_error")) return true;
        if (err != "network_error") File.Delete(LicenseFile);
        return false;
    }
}
```

`ProtectedData` necesita el paquete `System.Security.Cryptography.ProtectedData` y solo existe en Windows. En otras plataformas, guarda el archivo con permisos restringidos.

## 8. Lo que esta protección no cubre

- **Código en el navegador** (Angular, Next.js en cliente): se puede leer y modificar. La comprobación real debe estar en tu backend.
- **La clave de aplicación se puede extraer** de cualquier app distribuida: Flutter, .NET de escritorio o JavaScript. Sirve para distinguir apps y desactivarlas en bloque, no como secreto fuerte. Lo que de verdad protege es la clave de usuario más el límite de dispositivos.
- **El `device_id` lo genera la propia app.** Quien desmonte la app podría copiarlo, así que sirve para contar y limitar, no como prueba absoluta de identidad.
- **La revocación no es instantánea:** un dispositivo con token válido sigue funcionando hasta 7 días más 3 de gracia. Para acortarlo, baja `TOKEN_TTL_DAYS`, por ejemplo a 1, y la gracia en las apps. A cambio, las apps necesitarán conexión más a menudo. Los **vencimientos**, en cambio, sí son exactos, porque viajan dentro del token (`lic_exp`).
- **El reloj del dispositivo:** sin conexión, la app compara el vencimiento con su propio reloj. Quien atrase el reloj puede alargar una prueba mientras no se conecte; en cuanto renueve, el servidor usa su propia hora.
- **Las horas de uso las cuenta la app**, así que se pueden falsear. Úsalas como estadística, nunca para decidir si una licencia vale.
- **Quien modifique el binario** de una app compilada puede saltarse cualquier comprobación local. Esto vale para cualquier sistema de licencias. Este sistema lo dificulta, pero no lo hace imposible.

## 9. Operación y mantenimiento

### Copias de seguridad

En el servidor, cada día (por ejemplo con `cron`):

```bash
sudo -u postgres pg_dump -Fc gestor > /var/backups/gestor-$(date +%F).dump
```

Guarda también una copia de `secrets/` fuera del servidor. Si pierdes la clave privada, tendrás que generar otra y actualizar todas las apps.

### Actualizar el servicio

En el servidor:

```bash
cd /opt/gestor-de-claves && sudo git pull && sudo npm ci
```

Desde tu PC, con el túnel abierto:

```powershell
npm run db:migrate
```

```powershell
npm run db:roles
```

Ejecuta `db:roles` con el mismo `API_DB_PASSWORD` en tu `.env`. Si no lo pones, generará otra contraseña y tendrás que actualizar `DATABASE_URL` en el servidor. Después:

```bash
sudo systemctl restart gestor-api
```

### Rotar la clave de firma

Hazlo solo si sospechas que se filtró, porque obliga a actualizar todas las apps.

1. `npm run keys:generate -- --out secrets/nueva`.
2. Publica versiones de tus apps que acepten **las dos** claves públicas, eligiendo por el `kid` de la cabecera del token.
3. Cambia `SIGNING_PRIVATE_KEY_FILE` y `SIGNING_KEY_ID` en el servidor y reinicia.
4. Cuando todas las apps estén actualizadas, retira la clave pública vieja de ellas.

### Limpiar el registro de verificaciones

La tabla `verification_log` crece con cada verificación: calcula unos 150 MB al año por cada 10.000 dispositivos activos (estimación, no medida). Hazlo desde el panel, en **Registro de verificaciones** (sección 6): primero descargas el CSV hasta un día y luego borras hasta ese mismo día. Guardar unos 90 días suele bastar.

Si prefieres hacerlo sin panel, en el servidor (sin copia previa):

```bash
sudo -u postgres psql gestor -c "DELETE FROM verification_log WHERE at < now() - interval '90 days';"
```

### Si algo falla

- **La API no arranca:** `sudo journalctl -u gestor-api -n 50`. Si falta configuración, el mensaje dice qué variable revisar.
- **`invalid_client` en todas las llamadas:** la clave de aplicación de la app no coincide, o la app está desactivada en el panel.
- **`rate_limited` frecuente:** muchas apps detrás de la misma IP (una oficina, por ejemplo). Ajusta `RATE_LIMIT` en `packages/core/src/rate-limit.ts`.
- **El panel no conecta:** comprueba que el túnel SSH está abierto y que `ADMIN_DATABASE_URL` usa el puerto `5433`.
- **Todas las IP aparecen como `127.0.0.1`:** falta `TRUSTED_IP_HEADER=x-real-ip` o la línea `header_up` en Caddy.

## 10. Lista de comprobación de seguridad

- [ ] PostgreSQL escucha solo en `127.0.0.1` (`ss -ltnp | grep 5432`).
- [ ] Firewall con solo 22, 80 y 443 (`sudo ufw status`).
- [ ] SSH con clave pública y `PasswordAuthentication no` en `/etc/ssh/sshd_config`.
- [ ] La API usa `gk_api`, nunca `gk_owner`.
- [ ] `HOST=127.0.0.1` y `TRUSTED_IP_HEADER=x-real-ip`, con `header_up X-Real-IP {remote_host}` en Caddy.
- [ ] `signing-private.pem` con permisos `600`, propiedad de `gestor`, y una copia de seguridad fuera del servidor.
- [ ] `/etc/gestor-de-claves/api.env` con permisos `640`.
- [ ] `.env` y `secrets/` nunca subidos a Git (ya están en `.gitignore`).
- [ ] HTTPS funcionando (`curl.exe https://…/health`).
- [ ] Cada app comprueba firma, `iss`, `aud`, `device_id`, `exp` y `lic_exp` (este sin gracia), con la clave pública incrustada.
- [ ] Las apps web validan en su backend, no solo en el navegador.
- [ ] Copias de seguridad diarias de la base.
- [ ] Actualizaciones del sistema (`sudo apt upgrade`) y de dependencias (`npm audit`) periódicas.

## 11. Para el usuario final

Puedes copiar esta sección en la ayuda de tus apps.

**Activar la app**

1. Abre la app. La primera vez te pedirá una **clave de activación**.
2. Escribe la clave que te enviamos, por ejemplo `7K2QX-M9RTD-4HWZP-B3NVA-0YJ6E`. No importa si usas mayúsculas o minúsculas, ni si escribes los guiones.
3. Necesitas conexión a internet solo al activar y de vez en cuando para renovar. Si pasas unos días sin conexión, la app sigue funcionando.

**Mensajes que puedes ver**

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| La clave no es válida | La clave está mal escrita o no es de esta app. | Revísala letra por letra. |
| La clave ya está en uso en otro dispositivo | Tu clave permite un número limitado de dispositivos y ya están ocupados. | Pide a tu proveedor que libere el dispositivo anterior. |
| La clave ha vencido | Pasó la fecha de validez. | Contacta con tu proveedor para renovarla. |
| Terminó el periodo de uso en este dispositivo | Era una licencia de prueba o por tiempo, y el plazo de este dispositivo terminó. | Contacta con tu proveedor para ampliarla. |
| La clave ha sido desactivada | El proveedor la revocó. | Contacta con tu proveedor. |
| Demasiados intentos | Se probaron muchas claves seguidas. | Espera un minuto y vuelve a intentarlo. |
| Sin conexión con el servidor de licencias | No hay internet o el servidor no responde. | Revisa tu conexión y vuelve a intentarlo. |
| App no autorizada | Problema de configuración de la app. | Contacta con soporte. |

**Cambiar de dispositivo:** si cambias de móvil o de ordenador, pide a tu proveedor que libere el anterior. Después introduce la misma clave en el nuevo.

## 12. Publicar gratis en Render y Supabase

En lugar de un VPS: la base va en **Supabase** y la API en **Render**. El panel sigue en tu PC y se conecta directamente a Supabase, sin túnel SSH.

```
 TU PC (nunca publicado)              SUPABASE                     RENDER
 ┌──────────────────────┐  TLS   ┌────────────────────┐  TLS  ┌──────────────────────┐
 │ Panel 127.0.0.1:4000 │───────▶│ PostgreSQL         │◀──────│ API (usuario gk_api) │◀── tus apps
 │ (usuario postgres)   │        │ (pooler, sesión)   │       │ https://….onrender.com│   (HTTPS)
 └──────────────────────┘        └────────────────────┘       └──────────────────────┘
```

**Límites de los planes gratuitos** (compruébalos en sus webs, cambian con el tiempo):

- **Render duerme** el servicio tras 15 minutos sin peticiones, y la siguiente tarda hasta un minuto en despertarlo. Las apps con token válido no lo notan; quien activa una clave en ese momento espera. Por eso los ejemplos del capítulo 7 esperan hasta 60 segundos. Para evitarlo, configura un aviso periódico a `/wakeup` (sección 12.8). Para clientes que pagan, el plan de pago más barato de Render no duerme.
- **Supabase gratis** tiene unos 500 MB de base y pausa los proyectos que pasan mucho tiempo sin actividad. Limpia el registro de verificaciones de vez en cuando (sección 6).

### 12.1 Crear el proyecto de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com). Este proyecto usa la región **West EU (Ireland)**, `eu-west-1`; la región de Render más cercana es `frankfurt`, la que pone `render.yaml`. Si eliges otra región en Supabase, cambia `region` en `render.yaml` antes de crear el servicio, porque Render no deja cambiarla después. Supabase te pide una **contraseña de la base**: genera una larga y guárdala en tu gestor de contraseñas.
2. **Desactiva la Data API** (en *Project Settings*, apartado *Data API*). Este proyecto no la usa, y así nadie puede leer tus tablas por esa vía. Además, `npm run db:roles` les quita los permisos a los roles públicos de Supabase (`anon` y `authenticated`), por si se te olvida.
3. Pulsa **Connect** y, en **Session pooler**, copia la cadena de conexión (URI). Su usuario tiene la forma `postgres.<id-de-tu-proyecto>`. Usa el modo **sesión** (puerto **5432**), no el de transacción (puerto 6543): la API necesita bloqueos que el modo transacción no admite. Cambia `[YOUR-PASSWORD]`, corchetes incluidos, por la contraseña de la base.
4. En esa misma ventana, descarga el **certificado SSL** del servidor y guárdalo como `secrets/supabase-ca.crt` dentro de la carpeta del proyecto. Sin él, la conexión no podría comprobar que habla con Supabase de verdad.

### 12.2 Crear las tablas y el usuario de la API (en tu PC)

En tu `.env`:

```
ADMIN_DATABASE_URL=postgresql://postgres.<id-de-tu-proyecto>:<CONTRASEÑA>@aws-0-<region>.pooler.supabase.com:5432/postgres
# Ruta ABSOLUTA al certificado del paso anterior:
DATABASE_CA_FILE=D:\ruta\al\proyecto\secrets\supabase-ca.crt
API_DB_PASSWORD=
```

Si la contraseña tiene símbolos como `@`, `:` o `/`, en la URL van codificados (por ejemplo `@` se escribe `%40`).

```powershell
npm run db:migrate
```

```powershell
npm run db:roles
```

`db:roles` imprime la `DATABASE_URL` de la API, con el usuario `gk_api.<id-de-tu-proyecto>` y la contraseña generada. Guárdala: la necesitas en Render. Copia también esa contraseña a `API_DB_PASSWORD` en tu `.env`, para que la próxima vez que ejecutes `db:roles` (tras una actualización) no la cambie.

### 12.3 Claves de firma (en tu PC)

Si todavía no las tienes:

```powershell
npm run keys:generate
```

Crea `secrets/signing-private.pem`, `secrets/signing-public.pem` y te sugiere un identificador, por ejemplo `k-20261124`.

### 12.4 Crear el servicio en Render

1. En [render.com](https://render.com), **New → Blueprint** y elige tu repositorio de GitHub. Render lee el archivo `render.yaml` del proyecto, que ya trae el comando de arranque, `HOST=0.0.0.0`, la versión de Node y el resto de ajustes.
2. Render te pedirá dos valores:
   - `DATABASE_URL`: la que imprimió `db:roles`.
   - `SIGNING_KEY_ID`: el identificador de la clave de firma, por ejemplo `k-20261124`.
3. Cuando el servicio exista, entra en él: **Environment → Secret Files** y añade dos archivos, copiando su contenido:
   - `signing-private.pem`: el contenido de `secrets/signing-private.pem`.
   - `supabase-ca.crt`: el contenido de `secrets/supabase-ca.crt`.

   Render los deja en `/etc/secrets/`, que es donde los busca el `render.yaml`.
4. Pulsa **Manual Deploy → Deploy latest commit**. El primer despliegue puede haber fallado porque faltaban esos archivos; es normal.

### 12.5 Comprobar

Abre `https://<tu-servicio>.onrender.com/health` en el navegador. Debe responder `{"ok":true}`. Si falla, mira **Logs** en Render: si falta algo, el mensaje dice qué variable revisar.

### 12.6 Comprobar que la IP registrada es la real

El límite de intentos se basa en la IP. Hay que comprobar que nadie puede falsificarla con una cabecera.

**Por qué `TRUSTED_IP_HEADER` es `true-client-ip`.** En Render, `X-Forwarded-For` **no** es fiable: el proxy de Render añade la IP real al final, pero conserva lo que mande el cliente, así que la primera IP la elige quien llama (lo comprobamos el 2026-11-24). Delante de Render está Cloudflare, que escribe la IP real en `True-Client-IP` y reemplaza la que mande el cliente. Cloudflare rechaza con un 403 cualquier petición que traiga `CF-Connecting-IP`, por eso esa cabecera no entra en la prueba.

Desde tu PC envía una petición que finge venir de otras IPs:

```powershell
try { Invoke-RestMethod -Method Post -Uri "https://<tu-servicio>.onrender.com/v1/verify" -ContentType "application/json" -Headers @{ "X-Forwarded-For" = "203.0.113.77"; "True-Client-IP" = "198.51.100.9" } -Body '{"app_id":"prueba-ip","license_key":"x","device_id":"device-prueba-ip"}' } catch { $_.ErrorDetails.Message }
```

Responderá `invalid_client`, y es lo esperado. Después, en Supabase, abre **SQL Editor** y ejecuta:

```sql
select ip, at from verification_log where device_id = 'device-prueba-ip' order by at desc limit 1;
```

- Si aparece **tu IP pública real**: todo bien. Borra la fila de prueba con `delete from verification_log where device_id = 'device-prueba-ip';`.
- Si aparece **`203.0.113.77`** o **`198.51.100.9`**: la IP se puede falsificar. No publiques tus apps todavía: revisa `TRUSTED_IP_HEADER` en Render y repite la prueba.
- Si aparece **`unknown`**: Render dejó de enviar esa cabecera. Ninguna IP se falsifica, pero todas comparten un mismo límite de intentos. Revisa `TRUSTED_IP_HEADER`.

Repite esta prueba si cambias de proveedor o añades un dominio propio.

### 12.7 Conectar tus apps

La URL de la API es `https://<tu-servicio>.onrender.com`, o tu propio dominio si lo añades en Render (**Settings → Custom Domains**). El resto es igual que en el capítulo 7. La guía paso a paso para Flutter, web y backend, con una lista de pruebas, está en el [manual de apps](manual-apps.md).

### 12.8 Que no se duerma (cron-job.org)

La ruta `GET /wakeup` existe para un aviso periódico desde fuera:

- Cada llamada cuenta como actividad, así que Render no duerme el servicio.
- Como mucho una vez por minuto hace una consulta mínima (`select 1`) a Supabase, para que el proyecto tenga actividad y no se pause. Las demás llamadas de ese minuto reciben el último resultado, así que llamarla mucho no carga la base.
- Responde `{"ok":true}` (200) si la API y la base funcionan, y un **503** si la base no contesta en 10 segundos.

Para configurarlo:

1. Crea una cuenta en [cron-job.org](https://cron-job.org) y pulsa **Create cronjob**.
2. **URL:** `https://<tu-servicio>.onrender.com/wakeup`.
3. **Execution schedule:** **cada 5 minutos**. Render duerme a los 15 minutos sin peticiones, así que más seguido no aporta nada. cron-job.org tampoco permite menos de un minuto.
4. En **Notifications**, activa el aviso cuando falle. Un 503 te indica que la base no responde.
5. Guarda y pulsa **Test run**: debe responder `{"ok":true}`.

**Ojo con las horas gratis de Render:** el plan gratuito da unas 750 horas al mes **por cuenta**, en total. Un servicio despierto todo el mes gasta unas 744, así que te cabe **uno solo**. Si tienes otro servicio gratuito despierto en la misma cuenta, se acaban las horas y Render suspende los servicios gratuitos hasta el mes siguiente. Comprueba el consumo en **Billing** de Render.

### 12.9 Mantenimiento

- **Actualizar:** al subir cambios a GitHub (`git push`), Render vuelve a desplegar solo. Si la actualización trae migraciones, ejecuta antes `npm run db:migrate` y `npm run db:roles` desde tu PC.
- **Copias de seguridad:** revisa qué copias incluye tu plan de Supabase. Si quieres una propia y tienes las herramientas de PostgreSQL instaladas, `pg_dump` funciona con la misma `ADMIN_DATABASE_URL`.
- **Tu `.env` tiene ahora la contraseña del usuario dueño de una base accesible desde internet.** Protégelo como una contraseña y nunca lo subas a Git (ya está en `.gitignore`).

**Comprobación de seguridad para este modo:** Data API desactivada, `DATABASE_CA_FILE` configurado en tu PC y en Render, los dos Secret Files en Render, `DATABASE_URL` de Render con el usuario `gk_api` (nunca `postgres`) y la prueba de IP de la sección 12.6 superada.
