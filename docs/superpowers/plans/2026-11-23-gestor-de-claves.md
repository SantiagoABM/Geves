# Gestor de claves — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servicio de licencias: API pública que valida claves de usuario por app y dispositivo, panel de administración solo local, y manual de configuración.

**Architecture:** Monorepo con npm workspaces. `packages/core` contiene esquema, criptografía, lógica de verificación y de administración, y se prueba contra PostgreSQL embebido (PGlite). `apps/api` (Hono en Node) expone `POST /v1/verify` y nada de administración. `apps/admin` (Hono + JSX en el servidor) escucha solo en `127.0.0.1` y usa la base directamente con el usuario dueño.

**Tech Stack:** Node ≥ 22 (hay 24), TypeScript, Hono 4 + @hono/node-server, Drizzle ORM 0.45 + drizzle-kit, postgres (postgres.js) en producción, @electric-sql/pglite en pruebas, jose 6 (ES256), zod 4, vitest, tsx.

**Spec:** `docs/superpowers/specs/2026-11-23-gestor-de-claves-design.md`

## Global Constraints

- Firma ES256 con `kid` en la cabecera; claims `iss`, `aud` = slug de la app, `sub` = id interno de la clave, `device_id`, `iat`, `exp`.
- Vida del token: 7 días por defecto (`TOKEN_TTL_DAYS`). Gracia recomendada a las apps: 3 días; renovar cuando queden menos de 2.
- `max_devices` por defecto 1.
- Claves de usuario y de aplicación: se guardan solo como hash SHA-256, se muestran completas una sola vez, nunca en URLs, logs ni respuestas posteriores.
- La API pública no tiene ningún endpoint de administración.
- El rol de base de datos de la API (`gk_api`) no puede insertar ni modificar `apps` ni `license_keys`.
- La IP se guarda para auditoría y nunca se usa para bloquear (salvo la limitación de peticiones).
- `invalid_key` es genérico: no distingue clave inexistente de clave de otra app.
- Clave anterior de la app válida 30 días tras rotarla.
- Commits: el usuario no los ha pedido; no se hacen commits salvo que lo pida.

## Review Focus

- Clave tecleada en minúsculas, con espacios, sin guiones o con `O`/`I`/`L` en lugar de `0`/`1` → se acepta igual (test en Task 1).
- El mismo dispositivo verifica muchas veces → nunca gasta otro cupo; un dispositivo quitado que vuelve → necesita cupo libre (tests en Task 4).
- Cuerpo no JSON, demasiado grande, sin cabecera `X-App-Key` o con campos larguísimos → 400/401/413 sin traza de error (tests en Task 5).
- Tras rotar la clave de app, la anterior funciona hasta 30 días y luego da `invalid_client` (test en Task 4).
- Dos dispositivos activando a la vez con `max_devices = 1` → solo uno entra. Lo garantiza `SELECT … FOR UPDATE` en PostgreSQL real; PGlite tiene una sola conexión y no puede demostrarlo, así que el test en Task 4 cubre la secuencia y el bloqueo queda revisado a mano.

---

### Task 1: Estructura del repo y criptografía

**Files:**
- Create: `package.json` (workspaces `packages/*`, `apps/*`; scripts `test`, `typecheck`), `tsconfig.base.json` (strict, `module`/`moduleResolution` NodeNext, `jsx: react-jsx`, `jsxImportSource: hono/jsx`), `vitest.config.ts`, `.gitignore` (`node_modules`, `.env`, `secrets/`, `dist`), `.env.example`
- Create: `packages/core/package.json` (nombre `@gk/core`, `exports` → `src/index.ts`), `packages/core/src/index.ts`, `packages/core/src/crypto.ts`
- Test: `packages/core/test/crypto.test.ts`

**Interfaces:**
- Produces (`@gk/core`):
  - `LICENSE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"` (Crockford)
  - `generateLicenseKey(): string` → 25 caracteres del alfabeto con `crypto.randomInt`, en 5 grupos de 5 separados por `-`
  - `normalizeLicenseKey(input: string): string | null` → mayúsculas, quita espacios y guiones, `O`→`0`, `I`/`L`→`1`; `null` si no quedan exactamente 25 caracteres del alfabeto
  - `generateAppKey(): string` → `"gkapp_" + randomBytes(32).toString("base64url")`
  - `hashSecret(secret: string): string` → SHA-256 en hex
  - `secretHint(secret: string): string` → últimos 4 caracteres
  - `safeEqualHex(a: string, b: string): boolean` → `timingSafeEqual`, `false` si difieren en longitud

- [ ] **Step 1:** `git init`, crear los archivos de raíz, `npm install -D typescript vitest tsx @types/node` y en `packages/core` `npm install drizzle-orm postgres jose zod` + `-D drizzle-kit @electric-sql/pglite`.
- [ ] **Step 2: Test que falla** — `crypto.test.ts`:
  - `generateLicenseKey()` cumple `/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}$/` y 1000 llamadas dan 1000 valores distintos.
  - `normalizeLicenseKey(" abcde-fghjk-mnpqr-stvwx-yz0o1 ")` === `"ABCDEFGHJKMNPQRSTVWXYZ001"`; `normalizeLicenseKey("ilIL0-...")` mapea `I`,`L` a `1`; `normalizeLicenseKey("ABC")` === `null`; `normalizeLicenseKey("ABCDE-FGHJK-MNPQR-STVWX-YZ00U")` === `null` (U no está en el alfabeto).
  - `generateAppKey()` empieza por `gkapp_` y mide 49 caracteres.
  - `hashSecret("abc")` === `"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"`.
  - `safeEqualHex("aa","aa")` true, `("aa","ab")` false, `("aa","aaa")` false.
- [ ] **Step 3:** `npx vitest run packages/core/test/crypto.test.ts` → FALLA (módulo no existe).
- [ ] **Step 4:** Implementar `crypto.ts` con las firmas de arriba y reexportar desde `index.ts`.
- [ ] **Step 5:** Mismo comando → PASA.

### Task 2: Esquema, migraciones, base de pruebas y rol de la API

**Files:**
- Create: `packages/core/src/schema.ts`, `packages/core/src/db.ts`, `packages/core/src/testing.ts`, `packages/core/src/roles.ts`, `packages/core/drizzle.config.ts`, `packages/core/drizzle/` (generado)
- Test: `packages/core/test/schema.test.ts`

**Interfaces:**
- Produces:
  - Tablas Drizzle `apps`, `licenseKeys`, `devices`, `verificationLog` (columnas exactas de la spec, más en `apps`: `slug` text único = el `app_id` público, `prevApiKeyHash` text nulo, `prevApiKeyExpiresAt` timestamptz nulo). Ids `uuid defaultRandom()`, salvo `verificationLog.id` bigint identity. `licenseKeys.maxDevices` integer default 1 con check `>= 1`. `status` text con valores `"active" | "revoked"` (claves) y `"active" | "removed"` (dispositivos). Único `(keyId, deviceId)` en `devices`. Índice `(ip, at)` en `verificationLog`.
  - `type Db = PgDatabase<PgQueryResultHKT, typeof schema>`
  - `createPostgresDb(url: string): Db` (postgres.js, `ssl: "require"` salvo que la URL lleve `sslmode=disable`)
  - `createTestDb(): Promise<{ db: Db; pg: PGlite }>` → PGlite en memoria con las migraciones aplicadas (`drizzle-orm/pglite/migrator`)
  - `applyApiRoleGrants(db: Db, password: string): Promise<void>` → crea o actualiza el rol `gk_api` (LOGIN, contraseña) y concede: `SELECT` en `apps`, `license_keys`; `SELECT, INSERT, UPDATE` en `devices`; `SELECT, INSERT` en `verification_log` y `USAGE` en su secuencia. Revoca todo lo demás en el esquema `public`. Lanza error si `password` no cumple `/^[A-Za-z0-9_-]{24,128}$/` (se interpola en SQL).

- [ ] **Step 1:** Escribir `schema.ts` y `drizzle.config.ts`; `npx drizzle-kit generate` → aparece una migración SQL en `packages/core/drizzle/`.
- [ ] **Step 2: Test que falla** — `schema.test.ts`:
  - Tras `createTestDb()`, insertar una app y una clave con `maxDevices` omitido → se lee `1`.
  - Insertar dos dispositivos con el mismo `(keyId, deviceId)` → lanza error de unicidad.
  - `applyApiRoleGrants(db, "x")` → lanza error.
  - `applyApiRoleGrants(db, "a".repeat(32))`, luego `SET ROLE gk_api`: `SELECT` en `license_keys` funciona; `INSERT` en `license_keys` y `UPDATE` en `apps` lanzan `permission denied`; `INSERT` en `devices` funciona. Si PGlite no admite roles, se marca este caso como omitido con un comentario y se verifica en el manual contra PostgreSQL real.
- [ ] **Step 3:** `npx vitest run packages/core/test/schema.test.ts` → FALLA.
- [ ] **Step 4:** Implementar `db.ts`, `testing.ts`, `roles.ts`.
- [ ] **Step 5:** Mismo comando → PASA.

### Task 3: Tokens firmados

**Files:**
- Create: `packages/core/src/tokens.ts`
- Test: `packages/core/test/tokens.test.ts`

**Interfaces:**
- Produces:
  - `generateSigningKeys(): Promise<{ privateKeyPem: string; publicKeyPem: string }>` (ES256, PKCS8 y SPKI)
  - `interface TokenSigner { sign(c: { appSlug: string; keyId: string; deviceId: string }, now: Date): Promise<{ token: string; expiresAt: Date }> }`
  - `createTokenSigner(o: { privateKeyPem: string; kid: string; issuer: string; ttlSeconds: number }): Promise<TokenSigner>`
  - `verifyLicenseToken(token: string, publicKeyPem: string, o: { issuer: string; appSlug: string; deviceId: string; graceSeconds: number; now?: Date }): Promise<{ keyId: string; deviceId: string; expiresAt: Date }>` → lanza si la firma, `iss`, `aud`, `exp` (+gracia) o `device_id` no cuadran. Es la lógica de referencia que copian los clientes.

- [ ] **Step 1: Test que falla** — `tokens.test.ts`:
  - Firmar con TTL 7 días y verificar con la clave pública → devuelve `keyId` y `deviceId`; la cabecera decodificada tiene `alg: "ES256"` y el `kid` dado.
  - Verificar con otro `deviceId` → lanza; con otro `appSlug` → lanza; con la clave pública de otro par → lanza.
  - Token vencido hace 2 días con `graceSeconds` de 3 días → pasa; vencido hace 4 días → lanza.
- [ ] **Step 2:** `npx vitest run packages/core/test/tokens.test.ts` → FALLA.
- [ ] **Step 3:** Implementar con `SignJWT`, `jwtVerify` (`clockTolerance = graceSeconds`, `currentDate = now`), `importPKCS8`, `importSPKI`, `exportPKCS8`, `exportSPKI` de `jose`.
- [ ] **Step 4:** Mismo comando → PASA.

### Task 4: Administración y verificación en el núcleo

**Files:**
- Create: `packages/core/src/admin.ts`, `packages/core/src/verify.ts`, `packages/core/src/rate-limit.ts`, `packages/core/src/origins.ts`
- Test: `packages/core/test/admin.test.ts`, `packages/core/test/verify.test.ts`

**Interfaces:**
- Consumes: Task 1 (crypto), Task 2 (`Db`, tablas, `createTestDb`).
- Produces:
  - `createApp(db, i: { slug: string; name: string; url: string }): Promise<{ app: AppRow; appKey: string }>` — `slug` debe cumplir `/^[a-z0-9][a-z0-9-]{1,48}$/`, `url` debe ser `http:` o `https:`; si no, lanza `AdminInputError`.
  - `rotateAppKey(db, appId: string, now: Date): Promise<string>` — la actual pasa a `prevApiKeyHash` con caducidad `now + 30 días`.
  - `setAppActive(db, appId: string, active: boolean): Promise<void>`
  - `createLicenseKey(db, i: { appId: string; label: string; maxDevices?: number; expiresAt?: Date | null }): Promise<{ key: LicenseKeyRow; licenseKey: string }>` — `maxDevices` entero 1–1000, por defecto 1.
  - `revokeLicenseKey(db, keyId: string, now: Date)`, `setMaxDevices(db, keyId: string, n: number)`, `removeDevice(db, deviceRowId: string)`
  - `listApps(db)`, `getApp(db, appId)`, `listLicenseKeys(db, appId)` (con `activeDevices: number`), `getLicenseKeyDetail(db, keyId)` (clave + dispositivos)
  - `type VerifyError = "invalid_client" | "invalid_key" | "key_revoked" | "key_expired" | "device_limit_reached"`
  - `verifyLicense(db, i: { appSlug: string; appKey: string; licenseKey: string; deviceId: string; deviceName?: string; platform?: string; appVersion?: string }, ctx: { ip: string; now: Date }): Promise<{ ok: true; keyId: string; deviceId: string; newDevice: boolean } | { ok: false; error: VerifyError; maxDevices?: number }>`
  - `RATE_LIMIT = { perMinute: 30, failuresPer15Min: 10 }`; `isRateLimited(db, ip: string, now: Date): Promise<boolean>` — cuenta filas de `verificationLog` de esa IP.
  - `isAllowedOrigin(db, origin: string): Promise<boolean>` — `true` si coincide con el origen (`new URL(url).origin`) de una app activa.

Orden dentro de `verifyLicense`: app por slug (inexistente, inactiva o clave de app que no coincide con la actual ni con la anterior vigente → `invalid_client`) → normalizar clave (`null` → `invalid_key`) → clave por hash (inexistente o de otra app → `invalid_key`) → `revoked` → `key_revoked` → `expiresAt <= now` → `key_expired` → transacción con `SELECT … FOR UPDATE` sobre la clave: dispositivo activo → actualizar `lastSeen`, `lastIp`, nombre, plataforma y versión; si no, contar activos, y si `>= maxDevices` → `device_limit_reached`, si no, insertar o reactivar (`firstSeen = now`). Siempre se escribe una fila en `verificationLog` con `result` = `"ok"` o el error.

- [ ] **Step 1: Test que falla** — `admin.test.ts`:
  - `createApp` devuelve `appKey` que empieza por `gkapp_`; en la fila solo está `hashSecret(appKey)` y la pista; slug `"Mi App"` → `AdminInputError`; url `"ftp://x"` → `AdminInputError`.
  - `createLicenseKey` sin `maxDevices` → fila con 1; `maxDevices: 0` → `AdminInputError`.
  - `listLicenseKeys` refleja `activeDevices` tras registrar y quitar un dispositivo.
- [ ] **Step 2: Test que falla** — `verify.test.ts` (fixture: app + clave con `max 1`; `now` fijo):
  - Primera verificación → `ok`, `newDevice: true`; misma con otro `deviceId` → `device_limit_reached`, `maxDevices: 1`.
  - El mismo dispositivo 5 veces → todas `ok`, `newDevice: false` a partir de la segunda; sigue habiendo 1 dispositivo activo.
  - Clave tecleada como `minúsculas sin guiones` → `ok`.
  - Clave de app incorrecta → `invalid_client`; app desactivada → `invalid_client`.
  - Clave de otra app → `invalid_key`; clave basura `"hola"` → `invalid_key`.
  - Revocada → `key_revoked`; `expiresAt` igual a `now` → `key_expired`.
  - `setMaxDevices(…, 2)` → el segundo dispositivo entra.
  - `removeDevice` del primero → el segundo entra con `max 1`; el primero vuelve → `device_limit_reached`.
  - `rotateAppKey`: con la clave vieja a los 29 días → `ok`; a los 31 días → `invalid_client`; la nueva → `ok`.
  - Cada llamada deja una fila en `verificationLog` con el `result` esperado.
  - `isRateLimited`: tras 30 filas de la misma IP en el último minuto → `true`; tras 10 fallos en 15 minutos → `true`; otra IP → `false`.
  - `isAllowedOrigin(db, "https://miapp.com")` con app `url: "https://miapp.com/login"` → `true`; `"https://otra.com"` → `false`.
- [ ] **Step 3:** `npx vitest run packages/core/test/admin.test.ts packages/core/test/verify.test.ts` → FALLA.
- [ ] **Step 4:** Implementar los cuatro archivos.
- [ ] **Step 5:** Mismo comando → PASA.

### Task 5: API pública

**Files:**
- Create: `apps/api/package.json` (`@gk/api`, scripts `dev`, `start` con tsx), `apps/api/src/app.ts`, `apps/api/src/env.ts`, `apps/api/src/server.ts`
- Test: `apps/api/test/api.test.ts`

**Interfaces:**
- Consumes: Task 3 (`TokenSigner`, `verifyLicenseToken`), Task 4 (`verifyLicense`, `isRateLimited`, `isAllowedOrigin`).
- Produces: `createApiApp(d: { db: Db; signer: TokenSigner; ipHeader?: string; now?: () => Date }): Hono`
  - `GET /health` → `200 {"ok":true}`
  - `POST /v1/verify`: cabecera `X-App-Key`; cuerpo JSON `{ app_id, license_key, device_id, device_name?, platform?, app_version? }` validado con zod (`app_id` como el slug; `license_key` ≤ 64; `device_id` 8–128 de `[A-Za-z0-9._:-]`; los opcionales ≤ 100/30/30). Límite de cuerpo 4 KB (`hono/body-limit`).
  - Éxito `200 { ok: true, token, expires_at }`. Errores `{ ok: false, error, max_devices? }`: `bad_request` 400, `invalid_client` 401, `invalid_key`/`key_revoked`/`key_expired`/`device_limit_reached` 403, `rate_limited` 429 con `Retry-After: 60`, cuerpo grande 413, cualquier otra excepción 500 `{ ok:false, error:"server_error" }` sin detalles.
  - IP: valor de la cabecera `ipHeader` si está configurada (primer valor si trae comas), si no la dirección del socket (`getConnInfo` de `@hono/node-server/conninfo`).
  - CORS propio: si `Origin` cumple `isAllowedOrigin`, responder con `Access-Control-Allow-Origin` = ese origen, `Vary: Origin`, métodos `POST`, cabeceras `Content-Type, X-App-Key`; preflight `OPTIONS` 204. Sin origen permitido no se añaden cabeceras CORS.
  - `secureHeaders()` en todas las respuestas.
  - `env.ts`: `DATABASE_URL`, `SIGNING_PRIVATE_KEY` (PEM; acepta `\n` escapados), `SIGNING_KEY_ID`, `TOKEN_TTL_DAYS` (7), `ISSUER` (`gestor-de-claves`), `PORT` (3000), `TRUSTED_IP_HEADER` (opcional). Falta una obligatoria → el proceso termina con un mensaje claro.

- [ ] **Step 1: Test que falla** — `api.test.ts` (PGlite, `app.request(...)`, sin red):
  - Flujo completo: 200, y `verifyLicenseToken` con la clave pública y el mismo `device_id` devuelve el `keyId` de la clave.
  - Segundo dispositivo → 403 `device_limit_reached`, `max_devices: 1`.
  - Sin `X-App-Key` → 401 `invalid_client`; cuerpo `"no json"` → 400; `device_id` de 500 caracteres → 400; cuerpo de 10 KB → 413. Ninguna respuesta contiene `"stack"` ni `"at "`.
  - 31 peticiones desde la misma IP (`ipHeader: "x-test-ip"`) → la 31.ª da 429 con `Retry-After`.
  - `OPTIONS` con `Origin` de la app → 204 y `Access-Control-Allow-Origin`; con otro origen → sin esa cabecera.
  - No existe ninguna ruta bajo `/admin` (`GET /admin` → 404).
- [ ] **Step 2:** `npx vitest run apps/api` → FALLA.
- [ ] **Step 3:** Implementar `app.ts`, `env.ts`, `server.ts` (`serve({ fetch, port })` con la base `createPostgresDb(DATABASE_URL)`).
- [ ] **Step 4:** Mismo comando → PASA.

### Task 6: Panel local

**Files:**
- Create: `apps/admin/package.json` (`@gk/admin`, script `start`), `apps/admin/src/app.tsx`, `apps/admin/src/views.tsx`, `apps/admin/src/server.ts`
- Test: `apps/admin/test/admin-app.test.ts`

**Interfaces:**
- Consumes: Task 4 (funciones de administración).
- Produces: `createAdminApp(d: { db: Db; port: number; now?: () => Date }): Hono`
  - Guardia de `Host`: solo `127.0.0.1:<port>` o `localhost:<port>`; otro → 403 (evita DNS rebinding).
  - `csrf()` de `hono/csrf` con esos dos orígenes.
  - `Cache-Control: no-store` y `secureHeaders` con CSP `default-src 'self'` en todo; CSS servido en `/style.css`; sin JavaScript.
  - Rutas: `GET /` (apps + formulario), `POST /apps`, `GET /apps/:id` (claves + formulario + rotar + activar/desactivar), `POST /apps/:id/keys`, `POST /apps/:id/rotate`, `POST /apps/:id/active`, `GET /keys/:id` (dispositivos + máximo + revocar), `POST /keys/:id/revoke` (exige casilla `confirm=yes`), `POST /keys/:id/max-devices`, `POST /devices/:id/remove`.
  - Las claves nuevas (de app y de usuario) se muestran en la respuesta HTML del `POST`, nunca en una redirección ni en la URL.
  - `server.ts`: `ADMIN_DATABASE_URL`, `ADMIN_PORT` (4000); `serve({ hostname: "127.0.0.1" })`.

- [ ] **Step 1: Test que falla** — `admin-app.test.ts`:
  - `GET /` con `Host: evil.com` → 403; con `Host: 127.0.0.1:4000` → 200.
  - `POST /apps` con `Origin: https://evil.com` → 403.
  - `POST /apps` válido → el HTML contiene una cadena `gkapp_…` y la cabecera `Location` no existe; `Cache-Control` es `no-store`.
  - `POST /apps/:id/keys` → el HTML contiene una clave con el formato de Task 1; la base solo tiene su hash.
  - `POST /keys/:id/revoke` sin `confirm=yes` → la clave sigue activa; con él → `revoked`.
  - Entrada inválida (slug con espacios) → 400 con mensaje en el HTML, sin traza.
- [ ] **Step 2:** `npx vitest run apps/admin` → FALLA.
- [ ] **Step 3:** Implementar (todo texto se escapa porque JSX de Hono escapa por defecto; no usar `raw`).
- [ ] **Step 4:** Mismo comando → PASA.

### Task 7: Scripts de operación y cliente de referencia

**Files:**
- Create: `scripts/keys-generate.ts`, `scripts/db-migrate.ts`, `scripts/db-roles.ts`, `examples/node-client.ts`
- Modify: `package.json` (scripts `keys:generate`, `db:migrate`, `db:roles`, `admin`, `api`)
- Test: `examples/node-client.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces:
  - `npm run keys:generate` → escribe `secrets/signing-private.pem` y `secrets/signing-public.pem` (no sobrescribe si existen) e imprime un `kid` sugerido `k-AAAAMMDD`.
  - `npm run db:migrate` → aplica migraciones con `ADMIN_DATABASE_URL`.
  - `npm run db:roles` → `applyApiRoleGrants` con `API_DB_PASSWORD`; si no existe, genera una de 32 caracteres y la imprime una sola vez.
  - `examples/node-client.ts`: `checkLicense(o: { apiUrl: string; appSlug: string; appKey: string; publicKeyPem: string; issuer: string; storePath: string; deviceId: string; askLicenseKey: () => Promise<string> }): Promise<{ ok: true } | { ok: false; error: string }>` — usa el token guardado si es válido (gracia 3 días), lo renueva si quedan menos de 2 días, y pide la clave si no hay token.

- [ ] **Step 1: Test que falla** — `node-client.test.ts`: con la API de Task 5 servida en un puerto local sobre PGlite, `checkLicense` sin token pide la clave una vez y devuelve `ok`; la segunda llamada no pide la clave ni hace petición (API detenida → sigue `ok`); con un token manipulado → vuelve a pedir la clave.
- [ ] **Step 2:** `npx vitest run examples` → FALLA.
- [ ] **Step 3:** Implementar scripts y cliente.
- [ ] **Step 4:** Mismo comando → PASA; `npm test` completo → todo PASA; `npx tsc --noEmit -p .` → sin errores.

### Task 8: Manual de configuración

**Files:**
- Create: `docs/manual-configuracion.md`, `README.md` (breve, enlaza al manual)

Contenido del manual, en este orden, con comandos PowerShell para Windows y bash para el servidor:
1. Qué es y cómo funciona (diagrama de texto del flujo).
2. Requisitos.
3. Servidor recomendado: VPS Linux con Node 24, PostgreSQL escuchando solo en `localhost`, Caddy delante para HTTPS automático, firewall con solo 22/80/443 abiertos, servicio systemd para la API. El panel llega a la base por túnel SSH (`ssh -L 5433:localhost:5432`). Alternativa: Postgres gestionado (Neon) con TLS obligatorio.
4. Primera puesta en marcha: crear base y usuario dueño, `db:migrate`, `db:roles`, `keys:generate`, variables de entorno de la API (`TRUSTED_IP_HEADER=x-forwarded-for` detrás de Caddy), arrancar y comprobar `/health`.
5. Panel local: `.env` con `ADMIN_DATABASE_URL`, `npm run admin`, abrir `http://127.0.0.1:4000`.
6. Registrar una app, guardar su clave de aplicación; generar claves de usuario; cambiar máximo de dispositivos; revocar; quitar dispositivo para que el usuario cambie de equipo; rotar la clave de app.
7. Integrar cada cliente: contrato de la API (petición, respuestas, códigos), cómo guardar el token, renovar y aplicar la gracia, y fragmentos para Node/Express/NestJS/Next.js (servidor), Angular, Flutter y .NET, cada uno con cómo generar y guardar el ID de dispositivo y cómo comprobar `device_id`. Aviso claro de que los fragmentos de Flutter, .NET y Angular no están probados en este repo.
8. Lo que la protección no cubre (código en navegador, clave de app extraíble, revocación de hasta 7 días).
9. Operación: copias de seguridad de base y de `secrets/`, rotación de la clave de firma con `kid`, limpieza de `verification_log` (SQL de ejemplo para más de 90 días), qué mirar si algo falla.
10. Lista de comprobación de seguridad.
11. Sección para el usuario final: dónde introducir la clave y qué significa cada mensaje de error.

- [ ] **Step 1:** Escribir el manual siguiendo la lista anterior; los nombres de variables, scripts, rutas y códigos de error deben coincidir exactamente con Tasks 1–7.
- [ ] **Step 2:** Comprobar con `Grep` que cada variable de `apps/api/src/env.ts` y `apps/admin/src/server.ts` y cada script de `package.json` aparece en el manual.
