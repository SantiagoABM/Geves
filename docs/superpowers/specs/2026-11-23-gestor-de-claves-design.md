# Gestor de claves (servidor de licencias) — Diseño

Estado: **borrador pendiente de aprobación**. Fecha: 2026-11-23.

## Intención y por qué

El dueño tiene varias aplicaciones propias (Flutter, Next.js, .NET, Express, NestJS, Angular). Quiere que cada una pida una **clave de verificación** al usuario la primera vez que se abre, y que solo siga funcionando si esa clave está registrada en un servicio central. El servicio también registra los **dispositivos** que usan cada clave (ID de dispositivo e IP) para tener control sobre los usuarios y limitar cuántos dispositivos puede tener cada clave.

## Objetivos

- Una API pública que valide claves y registre dispositivos.
- Cada app se registra en el servicio (nombre, URL, `app_id`); cada clave pertenece a una app.
- Cada app tiene además su **propia clave de aplicación**, con la que se identifica ante el servicio como cliente registrado.
- Cada clave de usuario queda vinculada a los dispositivos que la registran. Por defecto el máximo es **1**: el primer dispositivo que la registra ocupa el cupo y un segundo dispositivo es rechazado, salvo que el dueño haya concedido 2 o más. El servidor lo hace cumplir.
- Las claves solo se crean desde un panel de administración **local** (nunca publicado), con un botón.
- La respuesta de validación va firmada, para que las apps la verifiquen sin conexión y toleren cortes cortos del servidor.
- Revocar claves y liberar cupos de dispositivos desde el panel.

## No objetivos (versión 1)

- SDKs completos para las seis plataformas. Se entrega el contrato de la API y un cliente de referencia en Node para pruebas; los fragmentos por plataforma vienen después.
- Cobros, planes de pago, usuarios o cuentas de cliente.
- Panel publicado en internet ni acceso de administración remoto.

## Anti-objetivos

- Que el panel o cualquier endpoint de administración sea alcanzable desde internet.
- Que un usuario legítimo quede bloqueado por una caída corta del servidor.
- Que alguien pueda generar claves comprometiendo solo la API pública.

## Flujo

1. **Administración (local):** el dueño registra la app (nombre, URL, `app_id`); al registrarla se genera su **clave de aplicación**, que se muestra una sola vez y se incrusta en la app. Después pulsa "Generar clave" indicando app, etiqueta (por ejemplo, el cliente), máximo de dispositivos y vencimiento opcional. La clave completa se muestra **una sola vez**.
2. **Primera apertura:** la app pide la clave al usuario y llama a `POST /v1/verify` enviando su clave de aplicación en la cabecera `X-App-Key` y, en el cuerpo, `app_id`, `key`, `device_id`, `device_name`, `platform` y `app_version`. La IP la toma el servidor de la conexión.
3. **Servidor:** primero comprueba la clave de aplicación contra el `app_id`; si no coincide, responde `invalid_client` sin mirar nada más. Después comprueba que la clave exista, esté activa, no haya vencido y pertenezca a esa app. Si el dispositivo ya está registrado, actualiza `last_seen` e `last_ip`. Si no, y hay cupo, lo registra. Si no hay cupo, rechaza.
4. **Respuesta:** un JWT firmado (ES256) de corta vida. La app lo guarda y lo verifica con la clave pública incrustada.
5. **Aperturas siguientes:** la app renueva el JWT antes de que venza llamando al mismo endpoint. Un solo endpoint idempotente sirve para activar y renovar.

Errores: `invalid_client` (clave de aplicación incorrecta o app desactivada), `invalid_key` (genérico, no distingue "no existe" de "es de otra app", para no permitir enumerar), `key_revoked`, `key_expired`, `device_limit_reached` (con el máximo), `rate_limited`.

## Modelo de datos (PostgreSQL)

- `apps`: id, `app_id` (slug único), name, url, `api_key_hash`, `api_key_hint` (últimos 4 caracteres), active, created_at.
- `license_keys`: id, app_id → apps, `key_hash` (único), `key_hint` (últimos 4 caracteres, solo para mostrar en el panel), label, max_devices (por defecto 1), expires_at, status (`active`/`revoked`), created_at, revoked_at.
- `devices`: id, key_id → license_keys, device_id, name, platform, app_version, first_ip, last_ip, first_seen, last_seen, status (`active`/`removed`). Único (key_id, device_id).
- `verification_log`: id, key_id (nulo si la clave no existe), app_id, device_id, ip, result, at.

## Decisiones de diseño

- **Formato de clave:** 128 bits aleatorios, en base32 con grupos (`XXXXX-XXXXX-...`). Se guarda solo el hash SHA-256 (suficiente porque la clave es aleatoria y larga); se busca por hash.
- **Cupo de dispositivos:** el registro corre en una transacción con bloqueo de la fila de la clave, para que dos peticiones simultáneas no superen el máximo.
- **Clave de aplicación:** secreto largo y aleatorio, guardado solo como hash, que identifica a la app como cliente registrado. Sirve para rechazar tráfico de apps no registradas, aplicar límites por app y desactivar una app entera. **No es un secreto fuerte en apps distribuidas** (Flutter, .NET de escritorio, Angular): quien tenga el binario o el JavaScript puede extraerla. Es una puerta de entrada, no la protección principal; la protección real es la clave de usuario más el cupo de dispositivos. En backends (Express, NestJS, servidor de Next.js) sí queda a salvo. Rotarla obliga a actualizar la app, así que el panel debe permitir que la anterior siga válida durante una transición (detalle del constructor).
- **Vinculación a dispositivo:** la primera verificación correcta con un `device_id` nuevo lo registra y ocupa un cupo; las siguientes del mismo `device_id` solo renuevan, sin consumir cupo. Con `max_devices = 1`, cualquier otro dispositivo recibe `device_limit_reached`. Para cambiar de dispositivo, el dueño quita el anterior desde el panel. El JWT lleva el `device_id` y la app debe rechazar un token cuyo `device_id` no sea el suyo, para que no se pueda copiar el token a otro equipo.
- **JWT:** ES256 (nativo o con librería estándar en las seis plataformas; Ed25519 se descartó porque .NET y algunos navegadores no lo soportan de serie). Claims: `iss`, `aud` = `app_id`, `sub` = id interno de la clave (nunca la clave), `device_id`, `iat`, `exp`. Cabecera con `kid` para poder rotar la clave de firma. La clave privada vive solo en el entorno de la API.
- **Vida y gracia:** `exp` de 7 días; la app renueva cuando le quedan menos de 2 y tolera hasta 3 días extra sin conexión. Cifras ajustables.
- **Separación de privilegios:** dos usuarios de base de datos. El de la API puede leer apps y claves, escribir dispositivos y log, pero **no** crear ni modificar claves. El del panel tiene permisos completos. La base solo acepta conexiones externas del panel desde la IP del dueño (o por túnel SSH).
- **Panel local:** aplicación web que escucha solo en `127.0.0.1` y se conecta directamente a la base con el usuario de administración. No existe API de administración pública.
- **Limitación de peticiones:** por IP y por hash de clave, para frenar la adivinación. HTTPS obligatorio. Detrás de un proxy, la IP se lee solo de la cabecera de un proxy de confianza.
- **ID de dispositivo:** lo genera cada plataforma de forma persistente (Flutter: UUID guardado en almacenamiento seguro; .NET: hash del identificador de máquina; Node/servidores: UUID guardado en archivo; navegador: UUID en almacenamiento local). Es información aportada por el cliente y, por tanto, falsificable: sirve para contar y limitar, no como garantía fuerte. La IP se guarda para auditoría y **no** se usa para bloquear.
- **Límite conocido:** el código que corre en el navegador del usuario (Angular, Next.js en cliente) puede alterarse. Para esas apps, la validación real debe hacerla su backend (Express, NestJS o el servidor de Next.js).

## Enfoques considerados

- **Pila (elegido: A).** A: TypeScript + Hono + PostgreSQL + Drizzle + `jose`; un lenguaje y un esquema compartidos entre API y panel. B: Python + FastAPI; menos reutilización entre API y panel y peor encaje en serverless. C: Go; más ligero pero hay que escribir mucho más a mano, sobre todo el panel.
- **Cómo habla el panel con el servidor (elegido: conexión directa a la base).** La alternativa era una API de administración protegida en el servidor público; se descartó porque crea una superficie atacable que el dueño explícitamente no quiere.
- **Qué devuelve la validación (elegido: JWT firmado).** La alternativa, un simple sí/no, obliga a que el servidor esté siempre disponible y se puede imitar con un servidor falso.

## Estructura propuesta

Monorepo: `packages/db` (esquema y migraciones), `apps/api` (API pública), `apps/admin` (panel local).

## Pendiente para el constructor

- Dónde alojar API y base de datos (VPS pequeño con PostgreSQL cerrado por firewall, o Vercel + Postgres gestionado con lista de IP permitidas).
- Cifras exactas de limitación de peticiones y de vida del token.
- Rotación de la clave de firma y copia de seguridad de la clave privada.
- Detalles del panel: lista de apps, lista de claves con estado y dispositivos, acciones de revocar y quitar dispositivo.

## Supuestos míos, a confirmar

- Cada clave sirve para **una sola app**.
- Quitar un dispositivo libera el cupo, y ese dispositivo puede volver a registrarse si hay cupo.
- Una clave revocada deja de funcionar en cuanto vence el JWT que la app ya tiene guardado (hasta 7 días), no al instante.
