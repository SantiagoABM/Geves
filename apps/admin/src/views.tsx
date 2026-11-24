import type { AppRow, DeviceRow, LicenseKeyRow, LicenseKeySummary } from "@gk/core";
import type { Child } from "hono/jsx";

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";

const pad = (n: number) => String(n).padStart(2, "0");
/** Valor para un <input type="date"> en la hora local. */
const dateValue = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";

const hours = (s: number | null) =>
  s === null ? "—" : `${(s / 3600).toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;

const rows = (n: number) => `${n.toLocaleString("es-ES")} fila${n === 1 ? "" : "s"}`;

export function Layout(p: { title: string; children: Child; error?: string | undefined }) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{p.title} · Gestor de claves</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <header>
          <a href="/" class="brand">
            Gestor de claves
          </a>
          <span class="local">Panel local</span>
          <nav>
            <a href="/">Apps</a>
            <a href="/log">Registro de verificaciones</a>
          </nav>
        </header>
        <main>
          {p.error && <p class="error">{p.error}</p>}
          {p.children}
        </main>
      </body>
    </html>
  );
}

function Secret(p: { label: string; value: string }) {
  return (
    <div class="secret">
      <p>
        <strong>{p.label}</strong>. Cópiala ahora: no se volverá a mostrar y no se puede recuperar.
      </p>
      <code>{p.value}</code>
    </div>
  );
}

export function HomePage(p: { apps: AppRow[]; error?: string | undefined }) {
  return (
    <Layout title="Apps" error={p.error}>
      <h1>Apps registradas</h1>
      {p.apps.length === 0 ? (
        <p class="muted">Todavía no hay apps.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>app_id</th>
              <th>URL</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {p.apps.map((a) => (
              <tr>
                <td>
                  <a href={`/apps/${a.id}`}>{a.name}</a>
                </td>
                <td>
                  <code>{a.slug}</code>
                </td>
                <td>{a.url}</td>
                <td>{a.active ? "Activa" : "Desactivada"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h2>Registrar app</h2>
      <form method="post" action="/apps" class="card">
        <label>
          Identificador (app_id)
          <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,48}" placeholder="mi-app" />
        </label>
        <label>
          Nombre
          <input name="name" required maxlength={100} />
        </label>
        <label>
          URL
          <input name="url" type="url" required placeholder="https://miapp.com" />
        </label>
        <button type="submit">Registrar y generar clave de aplicación</button>
      </form>
    </Layout>
  );
}

export function AppKeyShownPage(p: { app: AppRow; appKey: string; rotated: boolean }) {
  return (
    <Layout title={p.app.name}>
      <h1>{p.rotated ? "Clave de aplicación renovada" : "App registrada"}</h1>
      <p>
        App <strong>{p.app.name}</strong>, app_id <code>{p.app.slug}</code>.
      </p>
      <Secret label="Clave de aplicación (X-App-Key)" value={p.appKey} />
      {p.rotated && <p>La clave anterior seguirá funcionando 30 días para que puedas actualizar la app.</p>}
      <p>
        <a href={`/apps/${p.app.id}`}>Ir a la app</a>
      </p>
    </Layout>
  );
}

export function AppPage(p: { app: AppRow; keys: LicenseKeySummary[]; error?: string | undefined }) {
  const a = p.app;
  return (
    <Layout title={a.name} error={p.error}>
      <h1>{a.name}</h1>
      <dl class="card">
        <dt>app_id</dt>
        <dd>
          <code>{a.slug}</code>
        </dd>
        <dt>URL</dt>
        <dd>{a.url}</dd>
        <dt>Clave de aplicación</dt>
        <dd>
          <code>…{a.apiKeyHint}</code>
          {a.prevApiKeyExpiresAt && ` (la anterior vale hasta ${fmt(a.prevApiKeyExpiresAt)})`}
        </dd>
        <dt>Estado</dt>
        <dd>{a.active ? "Activa" : "Desactivada: todas sus verificaciones fallan"}</dd>
        <dt>Registrada</dt>
        <dd>{fmt(a.createdAt)}</dd>
      </dl>

      <h2>Claves de usuario</h2>
      {p.keys.length === 0 ? (
        <p class="muted">Sin claves todavía.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Etiqueta</th>
              <th>Clave</th>
              <th>Dispositivos</th>
              <th>Vence</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {p.keys.map((k) => (
              <tr>
                <td>
                  <a href={`/keys/${k.id}`}>{k.label}</a>
                </td>
                <td>
                  <code>…{k.keyHint}</code>
                </td>
                <td>
                  {k.activeDevices} / {k.maxDevices}
                </td>
                <td>{k.expiresAt ? fmt(k.expiresAt) : "Nunca"}</td>
                <td>{k.status === "active" ? "Activa" : "Revocada"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Generar clave</h2>
      <form method="post" action={`/apps/${a.id}/keys`} class="card">
        <label>
          Etiqueta (cliente o uso)
          <input name="label" required maxlength={100} />
        </label>
        <label>
          Máximo de dispositivos
          <input name="max_devices" type="number" min={1} max={1000} value="1" required />
        </label>
        <label>
          Vence el (opcional; vacío = nunca)
          <input name="expires_at" type="date" />
        </label>
        <label>
          Días de uso por dispositivo desde su activación (opcional; vacío = sin límite)
          <input name="device_validity_days" type="number" min={1} max={3650} placeholder="p. ej. 7 para una prueba" />
        </label>
        <button type="submit">Generar clave</button>
      </form>

      <h2>Acciones de la app</h2>
      <form method="post" action={`/apps/${a.id}/rotate`} class="card">
        <label class="check">
          <input type="checkbox" name="confirm" value="yes" required /> Confirmo que quiero renovar la clave de
          aplicación
        </label>
        <button type="submit">Renovar clave de aplicación</button>
      </form>
      <form method="post" action={`/apps/${a.id}/active`} class="card">
        <input type="hidden" name="active" value={a.active ? "0" : "1"} />
        <button type="submit" class={a.active ? "danger" : ""}>
          {a.active ? "Desactivar app" : "Reactivar app"}
        </button>
      </form>
    </Layout>
  );
}

// La prop se llama `row` y no `key`: en JSX `key` está reservada y no llega al componente.
export function LicenseKeyShownPage(p: { app: AppRow; row: LicenseKeyRow; licenseKey: string }) {
  return (
    <Layout title="Clave generada">
      <h1>Clave generada</h1>
      <p>
        Para <strong>{p.app.name}</strong>, etiqueta «{p.row.label}», hasta {p.row.maxDevices} dispositivo(s).
      </p>
      <Secret label="Clave de usuario" value={p.licenseKey} />
      <p>
        <a href={`/keys/${p.row.id}`}>Ver la clave</a> · <a href={`/apps/${p.app.id}`}>Volver a la app</a>
      </p>
    </Layout>
  );
}

export function LicenseKeyPage(p: { app: AppRow; row: LicenseKeyRow; devices: DeviceRow[]; error?: string | undefined }) {
  const k = p.row;
  const active = p.devices.filter((d) => d.status === "active").length;
  return (
    <Layout title={k.label} error={p.error}>
      <p>
        <a href={`/apps/${p.app.id}`}>← {p.app.name}</a>
      </p>
      <h1>{k.label}</h1>
      <dl class="card">
        <dt>Clave</dt>
        <dd>
          <code>…{k.keyHint}</code>
        </dd>
        <dt>Estado</dt>
        <dd>{k.status === "active" ? "Activa" : `Revocada el ${fmt(k.revokedAt)}`}</dd>
        <dt>Dispositivos</dt>
        <dd>
          {active} de {k.maxDevices}
        </dd>
        <dt>Vence</dt>
        <dd>{k.expiresAt ? fmt(k.expiresAt) : "Nunca"}</dd>
        <dt>Días por dispositivo</dt>
        <dd>{k.deviceValidityDays ? `${k.deviceValidityDays} días desde su activación` : "Sin límite"}</dd>
        <dt>Creada</dt>
        <dd>{fmt(k.createdAt)}</dd>
      </dl>

      <h2>Dispositivos</h2>
      {p.devices.length === 0 ? (
        <p class="muted">Ningún dispositivo ha usado esta clave.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID de dispositivo</th>
              <th>Nombre / plataforma</th>
              <th>IP (primera → última)</th>
              <th>Registrado → último uso</th>
              <th>Uso</th>
              <th>Vence</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {p.devices.map((d) => (
              <tr>
                <td>
                  <code>{d.deviceId}</code>
                </td>
                <td>
                  {d.name ?? "—"} {d.platform && `· ${d.platform}`} {d.appVersion && `· v${d.appVersion}`}
                </td>
                <td>
                  {d.firstIp} → {d.lastIp}
                </td>
                <td>
                  {fmt(d.firstSeen)} → {fmt(d.lastSeen)}
                </td>
                <td>{hours(d.usageSeconds)}</td>
                <td>
                  <form method="post" action={`/devices/${d.id}/expiry`} class="inline">
                    <input name="expires_at" type="date" value={dateValue(d.expiresAt)} aria-label="Vence el" />
                    <button type="submit" class="small">
                      Guardar
                    </button>
                  </form>
                  <span class="muted">{d.expiresAt ? fmt(d.expiresAt) : "Nunca"}</span>
                </td>
                <td>{d.status === "active" ? "Activo" : "Quitado"}</td>
                <td>
                  {d.status === "active" && (
                    <form method="post" action={`/devices/${d.id}/remove`}>
                      <button type="submit" class="danger small">
                        Quitar
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {p.devices.length > 0 && (
        <p class="muted">Para que un dispositivo no venza nunca, borra su fecha y pulsa Guardar.</p>
      )}

      {k.status === "active" && (
        <>
          <h2>Vencimiento de la clave</h2>
          <form method="post" action={`/keys/${k.id}/expiration`} class="card">
            <label>
              Vence el (vacío = nunca)
              <input name="expires_at" type="date" value={dateValue(k.expiresAt)} />
            </label>
            <label>
              Días de uso por dispositivo desde su activación (vacío = sin límite)
              <input
                name="device_validity_days"
                type="number"
                min={1}
                max={3650}
                value={k.deviceValidityDays ? String(k.deviceValidityDays) : ""}
              />
            </label>
            <p class="muted">
              Los días por dispositivo se aplican a los dispositivos que se activen a partir de ahora. Para cambiar uno
              ya activado, edita su fecha en la tabla de arriba.
            </p>
            <button type="submit">Guardar vencimiento</button>
          </form>

          <h2>Cambiar máximo de dispositivos</h2>
          <form method="post" action={`/keys/${k.id}/max-devices`} class="card">
            <label>
              Máximo
              <input name="max_devices" type="number" min={1} max={1000} value={String(k.maxDevices)} required />
            </label>
            <button type="submit">Guardar</button>
          </form>

          <h2>Revocar</h2>
          <form method="post" action={`/keys/${k.id}/revoke`} class="card">
            <p class="muted">
              Las apps dejarán de renovar con esta clave. Un dispositivo que ya tenga un token válido seguirá
              funcionando hasta que venza (máximo 7 días más la gracia).
            </p>
            <label class="check">
              <input type="checkbox" name="confirm" value="yes" required /> Confirmo que quiero revocar esta clave
            </label>
            <button type="submit" class="danger">
              Revocar clave
            </button>
          </form>
        </>
      )}
    </Layout>
  );
}

export function LogPage(p: {
  summary: { total: number; oldest: Date | null };
  deleted?: number;
  error?: string | undefined;
}) {
  return (
    <Layout title="Registro de verificaciones" error={p.error}>
      <h1>Registro de verificaciones</h1>
      {p.deleted !== undefined && <p class="notice">Se borraron {rows(p.deleted)}.</p>}
      <p>
        Hay {rows(p.summary.total)}
        {p.summary.oldest && `; la más antigua es del ${fmt(p.summary.oldest)}`}.
      </p>

      <h2>1. Descargar una copia</h2>
      <form method="get" action="/log/export" class="card">
        <label>
          Todo lo registrado hasta el día (incluido)
          <input name="until" type="date" required />
        </label>
        <button type="submit">Descargar CSV</button>
      </form>

      <h2>2. Borrar</h2>
      <form method="post" action="/log/delete" class="card">
        <label>
          Borrar todo lo registrado hasta el día (incluido)
          <input name="until" type="date" required />
        </label>
        <p class="muted">
          Usa el mismo día que en la descarga. Debe ser anterior a hoy. El borrado no se puede deshacer.
        </p>
        <label class="check">
          <input type="checkbox" name="confirm" value="yes" required /> Ya descargué la copia; borrar definitivamente
        </label>
        <button type="submit" class="danger">
          Borrar registros
        </button>
      </form>
    </Layout>
  );
}

export function MessagePage(p: { title: string; message: string }) {
  return (
    <Layout title={p.title}>
      <h1>{p.title}</h1>
      <p>{p.message}</p>
      <p>
        <a href="/">Volver al inicio</a>
      </p>
    </Layout>
  );
}

export const STYLE = `
*{box-sizing:border-box}
body{margin:0;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c1d21;background:#f6f6f4}
header{display:flex;align-items:center;gap:12px;padding:14px 32px;background:#1c1d21;color:#f6f6f4}
header .brand{color:inherit;text-decoration:none;font-weight:600}
header .local{font-size:12px;padding:2px 8px;border:1px solid #6b6d75;border-radius:999px;color:#c9cacf}
header nav{margin-left:auto;display:flex;gap:18px}header nav a{color:#c9cacf;text-decoration:none;font-size:14px}
header nav a:hover{color:#fff}
form.inline{display:flex;gap:6px;align-items:center;margin-bottom:4px}form.inline input{padding:3px 6px}
.notice{background:#e8f4ec;border:1px solid #9fd1b0;color:#14532d;padding:10px 14px;border-radius:6px}
main{max-width:1040px;margin:0 auto;padding:24px 32px 64px}
h1{font-size:24px;margin:8px 0 16px}h2{font-size:17px;margin:32px 0 10px}
a{color:#2453c7}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e2e2de}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid #ececea;vertical-align:top}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#6b6d75;background:#fafaf8}
code{font:13px ui-monospace,SFMono-Regular,Consolas,monospace}
.card{background:#fff;border:1px solid #e2e2de;border-radius:8px;padding:16px;display:grid;gap:12px;max-width:520px;margin:0 0 12px}
label{display:grid;gap:4px;font-size:13px;color:#45474e}
label.check{display:flex;align-items:center;gap:8px}
input{font:inherit;padding:7px 9px;border:1px solid #c9cacf;border-radius:6px}
button{font:inherit;padding:8px 14px;border:0;border-radius:6px;background:#1c1d21;color:#fff;cursor:pointer;justify-self:start}
button.danger{background:#b42318}button.small{padding:4px 10px;font-size:13px}
dl{grid-template-columns:max-content 1fr;column-gap:16px;row-gap:6px}dt{color:#6b6d75}dd{margin:0}
.secret{background:#fff8e6;border:1px solid #f0c75e;border-radius:8px;padding:16px;max-width:640px}
.secret code{display:block;font-size:20px;letter-spacing:.06em;padding:10px;background:#fff;border-radius:6px;user-select:all;word-break:break-all}
.error{background:#fdecea;border:1px solid #f1a7a0;color:#8a1c12;padding:10px 14px;border-radius:6px}
.muted{color:#6b6d75}
`;
