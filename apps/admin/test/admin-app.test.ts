import { createApp, devices, getLicenseKeyDetail, hashSecret, licenseKeys, verificationLog, type Db } from "@gk/core";
import { createTestDb } from "@gk/core/testing";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createAdminApp } from "../src/app.tsx";

const BASE = "http://127.0.0.1:4000";
const ORIGIN = { origin: BASE };
let db: Db;
let admin: ReturnType<typeof createAdminApp>;
let n = 0;

beforeAll(async () => {
  ({ db } = await createTestDb());
  admin = createAdminApp({ db, port: 4000 });
});

const post = (path: string, fields: Record<string, string>, headers: Record<string, string> = ORIGIN) =>
  admin.request(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });

describe("protecciones del panel", () => {
  it("rechaza peticiones con un Host que no es local", async () => {
    expect((await admin.request("http://evil.example/")).status).toBe(403);
  });

  it("acepta 127.0.0.1 y localhost", async () => {
    expect((await admin.request(`${BASE}/`)).status).toBe(200);
    expect((await admin.request("http://localhost:4000/")).status).toBe(200);
  });

  it("rechaza formularios enviados desde otro origen (CSRF)", async () => {
    const res = await post("/apps", { slug: "csrf-app", name: "x", url: "https://x.example" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("no deja nada en caché", async () => {
    const res = await admin.request(`${BASE}/`);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("apps y claves", () => {
  it("al crear una app muestra su clave una vez y sin redirigir", async () => {
    const res = await post("/apps", { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toMatch(/gkapp_[A-Za-z0-9_-]{43}/);
  });

  it("entrada no válida → 400 con mensaje y sin traza", async () => {
    const res = await post("/apps", { slug: "Mi App", name: "x", url: "https://x.example" });
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain("Identificador de app");
    expect(html).not.toMatch(/\bat [\w.]+ \(/);
  });

  it("al generar una clave la muestra una vez y guarda solo su hash", async () => {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    const res = await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1" });
    expect(res.status).toBe(200);
    const shown = (await res.text()).match(/[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){4}/)![0];
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.appId, app.id));
    expect(row!.keyHash).toBe(hashSecret(shown.replaceAll("-", "")));
  });

  it("revocar exige marcar la casilla de confirmación", async () => {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1" });
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.appId, app.id));
    await post(`/keys/${row!.id}/revoke`, {});
    expect((await getLicenseKeyDetail(db, row!.id))!.key.status).toBe("active");
    await post(`/keys/${row!.id}/revoke`, { confirm: "yes" });
    expect((await getLicenseKeyDetail(db, row!.id))!.key.status).toBe("revoked");
  });

  it("muestra la página de detalle de una clave", async () => {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    await post(`/apps/${app.id}/keys`, { label: "Cliente Pérez", max_devices: "2" });
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.appId, app.id));
    const res = await admin.request(`${BASE}/keys/${row!.id}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Cliente Pérez");
  });

  it("un id que no existe → 404", async () => {
    expect((await admin.request(`${BASE}/apps/no-existe`)).status).toBe(404);
  });

  it("muestra la fecha de registro de la app", async () => {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    expect(await (await admin.request(`${BASE}/apps/${app.id}`)).text()).toContain("Registrada");
  });
});

/** Crea una clave desde el panel y devuelve su fila. */
async function keyFromPanel(fields: Record<string, string> = {}) {
  const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
  await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1", ...fields });
  const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.appId, app.id));
  return row!;
}

describe("vencimientos", () => {
  it("al generar la clave se pueden fijar días por dispositivo (opcional)", async () => {
    expect((await keyFromPanel({ device_validity_days: "7" })).deviceValidityDays).toBe(7);
    expect((await keyFromPanel({ device_validity_days: "" })).deviceValidityDays).toBeNull();
  });

  it("días por dispositivo fuera de rango → 400 con mensaje", async () => {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    const res = await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1", device_validity_days: "0" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Días por dispositivo");
  });

  it("se puede cambiar y quitar el vencimiento de la clave", async () => {
    const row = await keyFromPanel({ expires_at: "2026-12-01" });
    await post(`/keys/${row.id}/expiration`, { expires_at: "2027-01-31", device_validity_days: "30" });
    let k = (await getLicenseKeyDetail(db, row.id))!.key;
    expect(k.expiresAt).toEqual(new Date("2027-01-31T23:59:59"));
    expect(k.deviceValidityDays).toBe(30);
    await post(`/keys/${row.id}/expiration`, { expires_at: "", device_validity_days: "" });
    k = (await getLicenseKeyDetail(db, row.id))!.key;
    expect(k.expiresAt).toBeNull();
    expect(k.deviceValidityDays).toBeNull();
  });

  it("se puede cambiar y quitar el vencimiento de un dispositivo, y se muestra con las horas de uso", async () => {
    const row = await keyFromPanel();
    const [d] = await db
      .insert(devices)
      .values({ keyId: row.id, deviceId: "device-panel", firstIp: "1.1.1.1", lastIp: "1.1.1.1", firstSeen: new Date(), lastSeen: new Date(), usageSeconds: 5400 })
      .returning();
    const res = await post(`/devices/${d!.id}/expiry`, { expires_at: "2027-02-28" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/keys/${row.id}`);
    let saved = (await getLicenseKeyDetail(db, row.id))!.devices[0]!;
    expect(saved.expiresAt).toEqual(new Date("2027-02-28T23:59:59"));
    const html = await (await admin.request(`${BASE}/keys/${row.id}`)).text();
    expect(html).toContain("1,5 h");
    await post(`/devices/${d!.id}/expiry`, { expires_at: "" });
    saved = (await getLicenseKeyDetail(db, row.id))!.devices[0]!;
    expect(saved.expiresAt).toBeNull();
  });
});

describe("diseño del panel", () => {
  const DAY = 86_400_000;
  const day = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * DAY);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  async function pages() {
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "App Diseño", url: "https://d.example" });
    await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1" });
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.appId, app.id));
    return { app, row: row!, paths: ["/", `/apps/${app.id}`, `/keys/${row!.id}`, "/log"] };
  }

  it("la barra lateral lista las apps en todas las páginas", async () => {
    const { paths } = await pages();
    for (const p of paths) {
      const html = await (await admin.request(`${BASE}${p}`)).text();
      expect(html, p).toContain('class="sidebar"');
      expect(html, p).toContain("App Diseño");
    }
  });

  it("sin estilos ni scripts en línea (la CSP los bloquearía)", async () => {
    const { app, paths } = await pages();
    const shown = await (await post(`/apps/${app.id}/keys`, { label: "Otra", max_devices: "1" })).text();
    const htmls = [shown, ...(await Promise.all(paths.map(async (p) => (await admin.request(`${BASE}${p}`)).text())))];
    for (const html of htmls) {
      expect(html).not.toContain("style=");
      expect(html).not.toContain("<style");
      expect(html).not.toMatch(/<script(?![^>]*\bsrc=)/);
    }
  });

  it("zona de peligro: desactivar app y revocar solo si la clave está activa", async () => {
    const { app, row } = await pages();
    const appHtml = await (await admin.request(`${BASE}/apps/${app.id}`)).text();
    expect(appHtml).toContain("Zona de peligro");
    expect(appHtml).toContain("Desactivar app");
    expect(await (await admin.request(`${BASE}/keys/${row.id}`)).text()).toContain("Revocar clave");
    await post(`/keys/${row.id}/revoke`, { confirm: "yes" });
    expect(await (await admin.request(`${BASE}/keys/${row.id}`)).text()).not.toContain("Revocar clave");
  });

  it("etiqueta «Vence pronto» solo a una semana o menos", async () => {
    const soon = await keyFromPanel({ expires_at: day(3) });
    const later = await keyFromPanel({ expires_at: day(30) });
    expect(await (await admin.request(`${BASE}/apps/${soon.appId}`)).text()).toContain("Vence pronto");
    expect(await (await admin.request(`${BASE}/apps/${later.appId}`)).text()).not.toContain("Vence pronto");
  });

  it("sirve /app.js y la clave generada tiene botón de copiar", async () => {
    const js = await admin.request(`${BASE}/app.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get("content-type")).toContain("javascript");
    const { app } = await createApp(db, { slug: `panel-${++n}`, name: "Demo", url: "https://demo.example" });
    const html = await (await post(`/apps/${app.id}/keys`, { label: "Cliente", max_devices: "1" })).text();
    expect(html).toContain('src="/app.js"');
    expect(html).toContain("data-copy");
  });
});

describe("registro de verificaciones", () => {
  const today = new Date("2026-11-24T12:00:00");
  let logAdmin: ReturnType<typeof createAdminApp>;

  beforeAll(async () => {
    const t = await createTestDb();
    logAdmin = createAdminApp({ db: t.db, port: 4000, now: () => today });
    await t.db.insert(verificationLog).values([
      { appSlug: "a", deviceId: "device-old", ip: "1.1.1.1", result: "ok", at: new Date("2026-10-01T10:00:00") },
      { appSlug: "a", deviceId: "device-new", ip: "1.1.1.1", result: "ok", at: new Date("2026-11-20T10:00:00") },
    ]);
  });

  const logPost = (fields: Record<string, string>) =>
    logAdmin.request(`${BASE}/log/delete`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", ...ORIGIN },
      body: new URLSearchParams(fields).toString(),
    });

  it("la página muestra cuántas filas hay", async () => {
    const html = await (await logAdmin.request(`${BASE}/log`)).text();
    expect(html).toContain("2 filas");
  });

  it("descarga en CSV lo que hay hasta el día elegido", async () => {
    const res = await logAdmin.request(`${BASE}/log/export?until=2026-10-31`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="verificaciones-hasta-2026-10-31.csv"');
    const csv = await res.text();
    expect(csv).toContain("device-old");
    expect(csv).not.toContain("device-new");
  });

  it("no acepta hoy ni fechas mal escritas", async () => {
    expect((await logAdmin.request(`${BASE}/log/export?until=2026-11-24`)).status).toBe(400);
    expect((await logAdmin.request(`${BASE}/log/export?until=hola`)).status).toBe(400);
  });

  it("borrar exige la casilla y luego borra solo hasta el día elegido", async () => {
    expect((await logPost({ until: "2026-10-31" })).status).toBe(400);
    expect(await (await logAdmin.request(`${BASE}/log`)).text()).toContain("2 filas");
    const res = await logPost({ until: "2026-10-31", confirm: "yes" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("1 fila");
    expect(await (await logAdmin.request(`${BASE}/log`)).text()).toContain("1 fila");
  });
});
