import type { AppRow, AppSummary, DeviceRow, LicenseKeyRow, LicenseKeySummary } from "@gk/core";
import type { Child } from "hono/jsx";

// La CSP del panel es `default-src 'self'`: nada de atributos style= ni <script>/<style> en línea.
// Todo el estilo va en STYLE (/style.css) y el único script en SCRIPT (/app.js).

const DAY = 86_400_000;
const SOON_DAYS = 7;

const fmt = (d: Date | null | undefined) =>
  d ? d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtDay = (d: Date | null | undefined) => (d ? d.toLocaleDateString("es-ES", { dateStyle: "short" }) : "—");

const pad = (n: number) => String(n).padStart(2, "0");
/** Valor para un <input type="date"> en la hora local. */
const dateValue = (d: Date | null | undefined) =>
  d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : "";

const hours = (s: number | null) =>
  s === null ? "—" : `${(s / 3600).toLocaleString("es-ES", { maximumFractionDigits: 1 })} h`;

const rows = (n: number) => `${n.toLocaleString("es-ES")} fila${n === 1 ? "" : "s"}`;

/** Vencida, vence pronto (≤ 7 días) o vigente. */
function expiry(d: Date | null | undefined, now: Date): "expired" | "soon" | "ok" {
  if (!d) return "ok";
  const left = d.getTime() - now.getTime();
  if (left <= 0) return "expired";
  return left <= SOON_DAYS * DAY ? "soon" : "ok";
}

type Tone = "ok" | "warn" | "bad" | "off";

function Badge(p: { tone: Tone; children: Child }) {
  return <span class={`badge ${p.tone}`}>{p.children}</span>;
}

function KeyBadge(p: { k: LicenseKeyRow; now: Date }) {
  if (p.k.status !== "active") return <Badge tone="off">Revocada</Badge>;
  const e = expiry(p.k.expiresAt, p.now);
  if (e === "expired") return <Badge tone="bad">Vencida</Badge>;
  if (e === "soon") return <Badge tone="warn">Vence pronto</Badge>;
  return <Badge tone="ok">Activa</Badge>;
}

function DeviceBadge(p: { d: DeviceRow; now: Date }) {
  if (p.d.status !== "active") return <Badge tone="off">Quitado</Badge>;
  const e = expiry(p.d.expiresAt, p.now);
  if (e === "expired") return <Badge tone="bad">Vencido</Badge>;
  if (e === "soon") return <Badge tone="warn">Vence pronto</Badge>;
  return <Badge tone="ok">Activo</Badge>;
}

/** Botón que despliega un formulario flotante. Sin JavaScript: es un <details>. */
function Fold(p: { label: string; primary?: boolean; open?: boolean; children: Child }) {
  return (
    <details class="fold" open={p.open || undefined}>
      <summary class={p.primary ? "btn primary" : "btn"}>{p.label}</summary>
      <div class="fold-body">{p.children}</div>
    </details>
  );
}

function Stat(p: { label: string; value: Child; hint?: Child }) {
  return (
    <div class="stat">
      <span>{p.label}</span>
      <b>{p.value}</b>
      {p.hint && <small>{p.hint}</small>}
    </div>
  );
}

function Danger(p: { children: Child }) {
  return (
    <section class="danger-zone">
      <h2>Zona de peligro</h2>
      {p.children}
    </section>
  );
}

export function Layout(p: {
  title: string;
  apps?: AppSummary[] | undefined;
  current?: string | undefined;
  error?: string | undefined;
  children: Child;
}) {
  return (
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{p.title} · Gestor de claves</title>
        <link rel="stylesheet" href="/style.css" />
        <script src="/app.js" defer></script>
      </head>
      <body>
        <aside class="sidebar">
          <a href="/" class="logo">
            <i></i>Gestor de claves
          </a>
          <div class="sec">Apps</div>
          <nav>
            {(p.apps ?? []).map((a) => (
              <a href={`/apps/${a.id}`} class={a.id === p.current ? "it on" : "it"} title={a.name}>
                <span class={a.active ? "dot" : "dot off"}></span>
                <span class="name">{a.name}</span>
                <span class="n">{a.activeKeys}</span>
              </a>
            ))}
            <a href="/#registrar" class="it add">
              ＋ Registrar app
            </a>
          </nav>
          <div class="sec">General</div>
          <nav>
            <a href="/log" class={p.current === "log" ? "it on" : "it"}>
              Registro de verificaciones
            </a>
          </nav>
          <div class="foot">Panel local · solo en tu PC</div>
        </aside>
        <main>
          {p.error && <p class="alert error">{p.error}</p>}
          {p.children}
        </main>
      </body>
    </html>
  );
}

function Secret(p: { label: string; value: string }) {
  return (
    <div class="secret">
      <p class="secret-title">{p.label}</p>
      <div class="secret-row">
        <code id="secret-value">{p.value}</code>
        <button type="button" class="btn primary" data-copy="secret-value" hidden>
          Copiar
        </button>
      </div>
      <p class="muted">Cópiala ahora: no se volverá a mostrar y no se puede recuperar.</p>
    </div>
  );
}

export function HomePage(p: { apps: AppSummary[]; error?: string | undefined; now?: Date }) {
  const totalKeys = p.apps.reduce((s, a) => s + a.activeKeys, 0);
  const totalDevices = p.apps.reduce((s, a) => s + a.activeDevices, 0);
  return (
    <Layout title="Apps" apps={p.apps} error={p.error}>
      <div class="head">
        <div>
          <div class="crumb">Inicio</div>
          <h1>Apps</h1>
          <div class="meta">
            <span>Tus apps registradas y sus licencias.</span>
          </div>
        </div>
        <div class="acts" id="registrar">
          <Fold label="＋ Registrar app" primary open={!!p.error || p.apps.length === 0}>
            <form method="post" action="/apps" class="form">
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
              <button type="submit" class="btn primary">
                Registrar y generar clave de aplicación
              </button>
            </form>
          </Fold>
        </div>
      </div>

      <div class="stats">
        <Stat label="Apps" value={p.apps.length} />
        <Stat label="Apps activas" value={p.apps.filter((a) => a.active).length} />
        <Stat label="Claves activas" value={totalKeys} />
        <Stat label="Dispositivos activos" value={totalDevices} />
      </div>

      {p.apps.length === 0 ? (
        <div class="empty">
          <b>Todavía no hay apps.</b>
          <p class="muted">Registra la primera con el botón de arriba.</p>
        </div>
      ) : (
        <div class="cards">
          {p.apps.map((a) => (
            <a href={`/apps/${a.id}`} class="app-card">
              <div class="app-card-top">
                <span class="app-name">{a.name}</span>
                {a.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="off">Desactivada</Badge>}
              </div>
              <code>{a.slug}</code>
              <div class="app-card-nums">
                <span>
                  <b>{a.activeKeys}</b> claves activas
                </span>
                <span>
                  <b>{a.activeDevices}</b> dispositivos
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </Layout>
  );
}

export function AppKeyShownPage(p: { apps: AppSummary[]; app: AppRow; appKey: string; rotated: boolean }) {
  return (
    <Layout title={p.app.name} apps={p.apps} current={p.app.id}>
      <div class="crumb">
        <a href="/">Apps</a> / <a href={`/apps/${p.app.id}`}>{p.app.name}</a>
      </div>
      <h1>{p.rotated ? "Clave de aplicación renovada" : "App registrada"}</h1>
      <p class="lead">
        App <strong>{p.app.name}</strong>, app_id <code class="pill">{p.app.slug}</code>.
      </p>
      <Secret label="Clave de aplicación (X-App-Key)" value={p.appKey} />
      {p.rotated && (
        <p class="alert info">La clave anterior seguirá funcionando 30 días para que puedas actualizar la app.</p>
      )}
      <p>
        <a href={`/apps/${p.app.id}`} class="btn">
          Ir a la app →
        </a>
      </p>
    </Layout>
  );
}

export function AppPage(p: {
  apps: AppSummary[];
  app: AppRow;
  keys: LicenseKeySummary[];
  error?: string | undefined;
  open?: "key" | "rotate" | undefined;
  now?: Date;
}) {
  const a = p.app;
  const now = p.now ?? new Date();
  const active = p.keys.filter((k) => k.status === "active");
  const soon = active.filter((k) => expiry(k.expiresAt, now) === "soon").length;
  return (
    <Layout title={a.name} apps={p.apps} current={a.id} error={p.error}>
      <div class="crumb">
        <a href="/">Apps</a> / {a.name}
      </div>
      <div class="head">
        <div>
          <h1>
            {a.name} {a.active ? <Badge tone="ok">Activa</Badge> : <Badge tone="off">Desactivada</Badge>}
          </h1>
          <div class="meta">
            <span>
              app_id <code class="pill">{a.slug}</code>
            </span>
            <span>
              Clave de app <code class="pill">…{a.apiKeyHint}</code>
            </span>
            <span>Registrada {fmt(a.createdAt)}</span>
            <span class="url">{a.url}</span>
          </div>
          {a.prevApiKeyExpiresAt && (
            <div class="meta">
              <span>La clave de app anterior sigue valiendo hasta {fmt(a.prevApiKeyExpiresAt)}.</span>
            </div>
          )}
        </div>
        <div class="acts">
          <Fold label="Renovar clave de app" open={p.open === "rotate"}>
            <form method="post" action={`/apps/${a.id}/rotate`} class="form">
              <p class="muted">
                Se genera una clave nueva. La actual seguirá funcionando 30 días para que actualices la app.
              </p>
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required /> Confirmo que quiero renovar la clave de
                aplicación
              </label>
              <button type="submit" class="btn primary">
                Renovar clave de aplicación
              </button>
            </form>
          </Fold>
          <Fold label="＋ Nueva clave" primary open={p.open === "key"}>
            <form method="post" action={`/apps/${a.id}/keys`} class="form">
              <label>
                Etiqueta (cliente o uso)
                <input name="label" required maxlength={100} />
              </label>
              <label>
                Máximo de dispositivos
                <input name="max_devices" type="number" min={1} max={1000} value="1" required />
              </label>
              <label>
                <span>Vence el <span class="hint">· opcional; vacío = nunca</span></span>
                <input name="expires_at" type="date" />
              </label>
              <label>
                <span>Días de uso por dispositivo <span class="hint">· opcional; vacío = sin límite</span></span>
                <input name="device_validity_days" type="number" min={1} max={3650} placeholder="p. ej. 7 para una prueba" />
              </label>
              <button type="submit" class="btn primary">
                Generar clave
              </button>
            </form>
          </Fold>
        </div>
      </div>

      {!a.active && <p class="alert warn">Esta app está desactivada: todas sus verificaciones fallan.</p>}

      <div class="stats">
        <Stat label="Claves activas" value={active.length} />
        <Stat label="Dispositivos activos" value={active.reduce((s, k) => s + k.activeDevices, 0)} />
        <Stat label={`Vencen en ${SOON_DAYS} días`} value={soon} />
        <Stat label="Revocadas" value={p.keys.length - active.length} />
      </div>

      <section class="panel">
        <div class="ph">Claves de usuario</div>
        {p.keys.length === 0 ? (
          <p class="muted pad">Sin claves todavía. Crea la primera con «＋ Nueva clave».</p>
        ) : (
          <div class="scroll">
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
                    <td class="wrap">
                      <a href={`/keys/${k.id}`} class="strong">
                        {k.label}
                      </a>
                    </td>
                    <td>
                      <code>…{k.keyHint}</code>
                    </td>
                    <td class="nowrap">
                      {k.activeDevices} / {k.maxDevices}{" "}
                      <meter min={0} max={k.maxDevices} value={k.activeDevices}></meter>
                    </td>
                    <td class="nowrap">{k.expiresAt ? fmtDay(k.expiresAt) : "Nunca"}</td>
                    <td>
                      <KeyBadge k={k} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Danger>
        <form method="post" action={`/apps/${a.id}/active`} class="danger-row">
          <input type="hidden" name="active" value={a.active ? "0" : "1"} />
          <div>
            <b>{a.active ? "Desactivar app" : "Reactivar app"}</b>
            <p class="muted">
              {a.active
                ? "Todas sus verificaciones fallan al momento. No se borra nada y puedes reactivarla."
                : "Vuelve a aceptar verificaciones con sus claves actuales."}
            </p>
          </div>
          <button type="submit" class={a.active ? "btn danger" : "btn"}>
            {a.active ? "Desactivar app" : "Reactivar app"}
          </button>
        </form>
      </Danger>
    </Layout>
  );
}

// La prop se llama `row` y no `key`: en JSX `key` está reservada y no llega al componente.
export function LicenseKeyShownPage(p: { apps: AppSummary[]; app: AppRow; row: LicenseKeyRow; licenseKey: string }) {
  return (
    <Layout title="Clave generada" apps={p.apps} current={p.app.id}>
      <div class="crumb">
        <a href="/">Apps</a> / <a href={`/apps/${p.app.id}`}>{p.app.name}</a>
      </div>
      <h1>Clave generada</h1>
      <p class="lead">
        Para <strong>{p.app.name}</strong>, etiqueta «{p.row.label}», hasta {p.row.maxDevices} dispositivo(s).
      </p>
      <Secret label="Clave de usuario" value={p.licenseKey} />
      <p class="row-links">
        <a href={`/keys/${p.row.id}`} class="btn">
          Ver la clave
        </a>
        <a href={`/apps/${p.app.id}`} class="btn">
          Volver a la app
        </a>
      </p>
    </Layout>
  );
}

export function LicenseKeyPage(p: {
  apps: AppSummary[];
  app: AppRow;
  row: LicenseKeyRow;
  devices: DeviceRow[];
  error?: string | undefined;
  open?: "settings" | undefined;
  now?: Date;
}) {
  const k = p.row;
  const now = p.now ?? new Date();
  const active = p.devices.filter((d) => d.status === "active").length;
  const usage = p.devices.reduce<number | null>((s, d) => (d.usageSeconds === null ? s : (s ?? 0) + d.usageSeconds), null);
  return (
    <Layout title={k.label} apps={p.apps} current={p.app.id} error={p.error}>
      <div class="crumb">
        <a href="/">Apps</a> / <a href={`/apps/${p.app.id}`}>{p.app.name}</a> / {k.label}
      </div>
      <div class="head">
        <div>
          <h1>
            {k.label} <KeyBadge k={k} now={now} />
          </h1>
          <div class="meta">
            <span>
              Clave <code class="pill">…{k.keyHint}</code>
            </span>
            <span>Creada {fmt(k.createdAt)}</span>
            {k.status !== "active" && <span>Revocada el {fmt(k.revokedAt)}</span>}
          </div>
        </div>
        {k.status === "active" && (
          <div class="acts">
            <Fold label="Ajustes" open={p.open === "settings"}>
              <form method="post" action={`/keys/${k.id}/expiration`} class="form">
                <b>Vencimiento</b>
                <label>
                  <span>Vence el <span class="hint">· vacío = nunca</span></span>
                  <input name="expires_at" type="date" value={dateValue(k.expiresAt)} />
                </label>
                <label>
                  <span>Días de uso por dispositivo <span class="hint">· vacío = sin límite</span></span>
                  <input
                    name="device_validity_days"
                    type="number"
                    min={1}
                    max={3650}
                    value={k.deviceValidityDays ? String(k.deviceValidityDays) : ""}
                  />
                </label>
                <p class="muted">
                  Los días por dispositivo valen para los que se activen desde ahora. Para uno ya activado, cambia su
                  fecha en la tabla.
                </p>
                <button type="submit" class="btn primary">
                  Guardar vencimiento
                </button>
              </form>
              <form method="post" action={`/keys/${k.id}/max-devices`} class="form sep">
                <b>Dispositivos</b>
                <label>
                  Máximo de dispositivos
                  <input name="max_devices" type="number" min={1} max={1000} value={String(k.maxDevices)} required />
                </label>
                <button type="submit" class="btn primary">
                  Guardar
                </button>
              </form>
            </Fold>
          </div>
        )}
      </div>

      <div class="stats">
        <Stat
          label="Dispositivos"
          value={
            <>
              {active} <small>/ {k.maxDevices}</small>
            </>
          }
          hint={<meter min={0} max={k.maxDevices} value={active}></meter>}
        />
        <Stat label="Vence" value={k.expiresAt ? fmtDay(k.expiresAt) : "Nunca"} />
        <Stat label="Días por dispositivo" value={k.deviceValidityDays ?? "Sin límite"} />
        <Stat label="Uso total" value={hours(usage)} />
      </div>

      <section class="panel">
        <div class="ph">Dispositivos</div>
        {p.devices.length === 0 ? (
          <p class="muted pad">Ningún dispositivo ha usado esta clave.</p>
        ) : (
          <div class="scroll">
            <table>
              <thead>
                <tr>
                  <th>Dispositivo</th>
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
                    <td class="wrap">
                      <span class="strong">{d.name ?? "Sin nombre"}</span>
                      <div class="sub">
                        {[d.platform, d.appVersion && `v${d.appVersion}`].filter(Boolean).join(" · ") || "—"}
                      </div>
                      <code class="sub id">{d.deviceId}</code>
                    </td>
                    <td class="nowrap">
                      {d.firstIp}
                      <div class="sub">→ {d.lastIp}</div>
                    </td>
                    <td class="nowrap">
                      {fmt(d.firstSeen)}
                      <div class="sub">→ {fmt(d.lastSeen)}</div>
                    </td>
                    <td class="nowrap">{hours(d.usageSeconds)}</td>
                    <td class="nowrap">
                      <form method="post" action={`/devices/${d.id}/expiry`} class="inline">
                        <input name="expires_at" type="date" value={dateValue(d.expiresAt)} aria-label="Vence el" />
                        <button type="submit" class="btn small">
                          Guardar
                        </button>
                      </form>
                    </td>
                    <td>
                      <DeviceBadge d={d} now={now} />
                    </td>
                    <td>
                      {d.status === "active" && (
                        <form method="post" action={`/devices/${d.id}/remove`}>
                          <button type="submit" class="btn small danger">
                            Quitar
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {p.devices.length > 0 && (
        <p class="muted note">
          Para que un dispositivo no venza nunca, borra su fecha y pulsa Guardar. Quitar libera su plaza; si vuelve a
          activarse, conserva su vencimiento.
        </p>
      )}

      {k.status === "active" && (
        <Danger>
          <form method="post" action={`/keys/${k.id}/revoke`} class="danger-row">
            <div>
              <b>Revocar clave</b>
              <p class="muted">
                Las apps dejarán de renovar con esta clave. Un dispositivo con un token válido seguirá funcionando hasta
                que venza (máximo 7 días más la gracia).
              </p>
              <label class="check">
                <input type="checkbox" name="confirm" value="yes" required /> Confirmo que quiero revocar esta clave
              </label>
            </div>
            <button type="submit" class="btn danger">
              Revocar clave
            </button>
          </form>
        </Danger>
      )}
    </Layout>
  );
}

export function LogPage(p: {
  apps: AppSummary[];
  summary: { total: number; oldest: Date | null };
  deleted?: number;
  error?: string | undefined;
}) {
  return (
    <Layout title="Registro de verificaciones" apps={p.apps} current="log" error={p.error}>
      <div class="crumb">General</div>
      <h1>Registro de verificaciones</h1>
      {p.deleted !== undefined && <p class="alert ok">Se borraron {rows(p.deleted)}.</p>}
      <div class="stats two">
        <Stat label="Filas guardadas" value={rows(p.summary.total)} />
        <Stat label="La más antigua" value={fmt(p.summary.oldest)} />
      </div>

      <div class="steps">
        <section class="panel step">
          <div class="ph">
            <span class="num">1</span>Descargar una copia
          </div>
          <form method="get" action="/log/export" class="form pad">
            <label>
              Todo lo registrado hasta el día (incluido)
              <input name="until" type="date" required />
            </label>
            <p class="muted">Archivo CSV separado por «;», listo para Excel.</p>
            <button type="submit" class="btn primary">
              Descargar CSV
            </button>
          </form>
        </section>

        <section class="panel step danger-panel">
          <div class="ph">
            <span class="num">2</span>Borrar
          </div>
          <form method="post" action="/log/delete" class="form pad">
            <label>
              Borrar todo lo registrado hasta el día (incluido)
              <input name="until" type="date" required />
            </label>
            <p class="muted">Usa el mismo día que en la descarga. Debe ser anterior a hoy. No se puede deshacer.</p>
            <label class="check">
              <input type="checkbox" name="confirm" value="yes" required /> Ya descargué la copia; borrar definitivamente
            </label>
            <button type="submit" class="btn danger">
              Borrar registros
            </button>
          </form>
        </section>
      </div>
    </Layout>
  );
}

export function MessagePage(p: { title: string; message: string; apps?: AppSummary[] | undefined }) {
  return (
    <Layout title={p.title} apps={p.apps}>
      <div class="empty">
        <h1>{p.title}</h1>
        <p class="muted">{p.message}</p>
        <a href="/" class="btn">
          Volver al inicio
        </a>
      </div>
    </Layout>
  );
}

/** Botón «Copiar» de las claves recién creadas. Sin JS el botón sigue oculto y la clave se selecciona a mano. */
export const SCRIPT = `
document.querySelectorAll("[data-copy]").forEach(function (btn) {
  var target = document.getElementById(btn.getAttribute("data-copy"));
  if (!target || !navigator.clipboard) return;
  btn.hidden = false;
  function say(text) {
    btn.textContent = text;
    setTimeout(function () { btn.textContent = "Copiar"; }, 2500);
  }
  btn.addEventListener("click", function () {
    navigator.clipboard.writeText(target.textContent.trim()).then(
      function () { say("Copiada ✓"); },
      function () {
        // Sin permiso para el portapapeles: deja la clave seleccionada para copiarla a mano.
        var range = document.createRange();
        range.selectNodeContents(target);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        say("Pulsa Ctrl+C");
      }
    );
  });
});
`;

export const STYLE = `
:root{
  color-scheme:dark;
  --bg:#0b0d12;--side:#0f1218;--panel:#11141c;--panel-2:#0f1219;--input:#0b0d12;
  --line:#1e2230;--line-2:#1a1e2a;--line-3:#262b3a;
  --text:#e6e8ee;--soft:#b9bfcc;--muted:#8a90a2;
  --accent:#10b981;--accent-ink:#04140e;--accent-text:#34d399;--accent-soft:#0f2a20;
  --warn:#fbbf24;--warn-soft:#2a2210;--bad:#f87171;--bad-soft:#2d1418;--bad-line:#3b1d1d;--off-soft:#1a1e29;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:14px/1.5 "Segoe UI",system-ui,-apple-system,sans-serif;display:grid;grid-template-columns:232px minmax(0,1fr);min-height:100vh}
a{color:var(--accent-text);text-decoration:none}a:hover{text-decoration:underline}
code{font:12.5px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--soft)}
h1{font-size:24px;font-weight:650;letter-spacing:-.01em;margin:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h2{font-size:15px;margin:0}
.muted{color:var(--muted)}
p{margin:0}

/* Barra lateral */
.sidebar{background:var(--side);border-right:1px solid var(--line);padding:18px 12px;display:flex;flex-direction:column;gap:2px;position:sticky;top:0;height:100vh;overflow-y:auto}
.logo{display:flex;align-items:center;gap:10px;font-weight:650;font-size:15px;color:var(--text);padding:4px 8px 16px}
.logo:hover{text-decoration:none}
.logo i{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,#10b981,#0ea5e9);flex:none}
.sec{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);padding:14px 8px 6px}
.sidebar nav{display:flex;flex-direction:column;gap:2px}
.it{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:7px;color:var(--soft);font-size:13.5px}
.it:hover{background:#151925;text-decoration:none;color:var(--text)}
.it.on{background:var(--accent-soft);color:var(--accent-text);font-weight:600}
.it .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.it .n{font-size:11.5px;color:var(--muted)}
.it.add{color:var(--accent-text)}
.dot{width:7px;height:7px;border-radius:50%;background:var(--accent-text);flex:none}
.dot.off{background:#4b5163}
.foot{margin-top:auto;font-size:11.5px;color:var(--muted);background:#141822;border-radius:7px;padding:9px 10px}

/* Contenido */
main{padding:28px 36px 64px;display:flex;flex-direction:column;gap:20px;max-width:1240px;width:100%}
.crumb{font-size:12.5px;color:var(--muted)}
.crumb a{color:var(--muted)}.crumb a:hover{color:var(--text)}
.head{display:flex;align-items:flex-start;gap:20px;flex-wrap:wrap}
.head>div:first-child{flex:1;min-width:280px;display:flex;flex-direction:column;gap:8px}
.meta{display:flex;flex-wrap:wrap;gap:6px 18px;font-size:12.5px;color:var(--muted)}
.meta .url{overflow-wrap:anywhere}
.pill{background:#161a24;border:1px solid var(--line-2);border-radius:5px;padding:1px 6px;font-size:12px}
.lead{color:var(--soft)}
.acts{display:flex;gap:8px;align-items:flex-start}

/* Botones */
.btn{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:13px;font-weight:600;padding:7px 13px;border-radius:8px;border:1px solid var(--line-3);background:#141822;color:var(--text);cursor:pointer;white-space:nowrap;list-style:none;user-select:none}
.btn:hover{background:#1a1f2c;text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{background:#34d399}
.btn.danger{background:#1a1114;border-color:var(--bad-line);color:var(--bad)}
.btn.danger:hover{background:#241418}
.btn.small{padding:4px 10px;font-size:12px;font-weight:550}
.btn:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.btn{justify-self:start}
.row-links{display:flex;gap:8px}

/* Formularios plegados */
.fold{position:relative}
.fold>summary::-webkit-details-marker{display:none}
.fold>summary::marker{content:""}
.fold[open]>summary{border-color:var(--accent)}
.fold[open]>summary.primary{box-shadow:0 0 0 3px #10b98133}
.fold-body{position:absolute;right:0;top:calc(100% + 8px);width:380px;max-width:calc(100vw - 48px);z-index:30;background:var(--panel);border:1px solid var(--line-3);border-radius:12px;padding:16px;box-shadow:0 18px 50px #000a;display:flex;flex-direction:column;gap:16px}
.form{display:grid;gap:12px}
.form.sep{border-top:1px solid var(--line-2);padding-top:16px}
.form.pad{padding:16px}
label{display:grid;gap:5px;font-size:12.5px;color:var(--soft)}
label .hint{color:var(--muted);font-weight:400}
label.check{display:flex;align-items:flex-start;gap:8px;color:var(--soft)}
label.check input{margin-top:3px;accent-color:var(--accent)}
input{font:inherit;font-size:13.5px;padding:8px 10px;border:1px solid var(--line-3);border-radius:8px;background:var(--input);color:var(--text);width:100%}
input::placeholder{color:#5b6173}
input[type=checkbox]{width:auto}
form.inline{display:flex;gap:6px;align-items:center}
form.inline input{padding:4px 7px;width:auto;font-size:12.5px}

/* Cifras */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.stats.two{grid-template-columns:repeat(2,minmax(0,1fr));max-width:620px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:14px 16px;display:flex;flex-direction:column;gap:2px;min-width:0}
.stat span{font-size:12px;color:var(--muted)}
.stat b{font-size:22px;font-weight:650;overflow-wrap:anywhere}
.stat b small{font-size:14px;color:var(--muted);font-weight:500}
.stat>small{margin-top:4px}

/* Paneles y tablas */
.panel{background:var(--panel);border:1px solid var(--line);border-radius:11px;overflow:hidden}
.ph{display:flex;align-items:center;gap:10px;padding:12px 16px;font-weight:600;border-bottom:1px solid var(--line-2)}
.pad{padding:16px}
.scroll{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;color:var(--muted);background:var(--panel-2);padding:9px 16px;white-space:nowrap}
td{padding:11px 16px;border-top:1px solid var(--line-2);vertical-align:top}
tbody tr:hover td{background:#131722}
td.nowrap{white-space:nowrap}
td.wrap{overflow-wrap:anywhere;min-width:160px;max-width:320px}
.strong{color:var(--text);font-weight:600}
a.strong:hover{color:var(--accent-text)}
.sub{font-size:12px;color:var(--muted);margin-top:2px}
code.sub.id{display:block;font-size:11.5px;overflow-wrap:anywhere}
.note{font-size:12.5px;margin-top:-8px}
meter{width:72px;height:6px;vertical-align:middle;margin-left:6px;border:0;border-radius:3px;background:var(--line)}
meter::-webkit-meter-bar{background:var(--line);border:0;border-radius:3px;height:6px}
meter::-webkit-meter-optimum-value,meter::-webkit-meter-suboptimum-value,meter::-webkit-meter-even-less-good-value{background:var(--accent);border-radius:3px}
meter::-moz-meter-bar{background:var(--accent);border-radius:3px}
.stat meter{margin-left:0;width:100%}

/* Etiquetas de estado */
.badge{display:inline-flex;align-items:center;gap:6px;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;letter-spacing:0}
.badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.ok{background:var(--accent-soft);color:var(--accent-text)}
.badge.warn{background:var(--warn-soft);color:var(--warn)}
.badge.bad{background:var(--bad-soft);color:var(--bad)}
.badge.off{background:var(--off-soft);color:var(--muted)}
h1 .badge{font-size:12px}

/* Tarjetas de apps (inicio) */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
.app-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px;color:var(--text);min-width:0}
.app-card:hover{border-color:#2f3547;background:#131722;text-decoration:none}
.app-card-top{display:flex;align-items:center;gap:10px}
.app-name{font-weight:650;font-size:15px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.app-card-nums{display:flex;gap:16px;font-size:12.5px;color:var(--muted);margin-top:4px}
.app-card-nums b{color:var(--text);font-size:15px}
.empty{background:var(--panel);border:1px dashed var(--line-3);border-radius:12px;padding:28px;display:flex;flex-direction:column;gap:10px;align-items:flex-start}

/* Avisos */
.alert{padding:11px 14px;border-radius:9px;border:1px solid}
.alert.error{background:var(--bad-soft);border-color:var(--bad-line);color:#fca5a5}
.alert.warn{background:var(--warn-soft);border-color:#3d3216;color:var(--warn)}
.alert.ok{background:var(--accent-soft);border-color:#164e3a;color:var(--accent-text)}
.alert.info{background:#101a2b;border-color:#1d3557;color:#93c5fd}

/* Secretos recién creados */
.secret{background:linear-gradient(180deg,#10241c,#0f1a17);border:1px solid #1f5c45;border-radius:14px;padding:20px;display:flex;flex-direction:column;gap:12px;max-width:760px}
.secret-title{font-weight:650;color:var(--accent-text)}
.secret-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.secret code{flex:1;min-width:0;font-size:20px;letter-spacing:.06em;color:var(--text);background:var(--bg);border:1px solid var(--line-3);border-radius:9px;padding:12px 14px;user-select:all;overflow-wrap:anywhere}

/* Zona de peligro */
.danger-zone{border:1px solid var(--bad-line);background:#140e11;border-radius:11px;padding:16px;display:flex;flex-direction:column;gap:12px}
.danger-zone h2{color:var(--bad);font-size:13px;text-transform:uppercase;letter-spacing:.06em}
.danger-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.danger-row>div{flex:1;min-width:260px;display:flex;flex-direction:column;gap:6px}

/* Registro */
.steps{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.num{display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--accent-soft);color:var(--accent-text);font-size:12px}
.danger-panel{border-color:var(--bad-line)}
.danger-panel .num{background:var(--bad-soft);color:var(--bad)}

@media (max-width:900px){
  body{grid-template-columns:1fr}
  .sidebar{position:static;height:auto}
  main{padding:20px}
  .stats,.steps{grid-template-columns:repeat(2,minmax(0,1fr))}
  .fold-body{right:auto;left:0}
}
`;
