import { serve, type ServerType } from "@hono/node-server";
import { createApp, createLicenseKey, createTokenSigner, generateSigningKeys, revokeLicenseKey, type Db } from "@gk/core";
import { createTestDb } from "@gk/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "../../apps/api/src/app.ts";
import { LicenseClient, type LicenseConfig, type LicenseStorage } from "./license.ts";

const DAY = 86_400_000;
const ORIGIN = "https://web.example";
let db: Db;
let server: ServerType;
let config: LicenseConfig;
const keys = { free: "", single: "", trial: "", revoked: "" };

class MemoryStorage implements LicenseStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

/** fetch que cuenta llamadas y puede simular que no hay red. */
function netFetch() {
  const state = { calls: 0, offline: false };
  const f: typeof fetch = async (...args) => {
    state.calls++;
    if (state.offline) throw new TypeError("Failed to fetch");
    return fetch(...args);
  };
  return { state, f };
}

beforeAll(async () => {
  ({ db } = await createTestDb());
  const signing = await generateSigningKeys();
  const signer = await createTokenSigner({ privateKeyPem: signing.privateKeyPem, kid: "k1", issuer: "gestor-de-claves", ttlSeconds: 7 * 86_400 });
  const { app, appKey } = await createApp(db, { slug: "cliente-web", name: "Web", url: `${ORIGIN}/` });
  keys.free = (await createLicenseKey(db, { appId: app.id, label: "Libre", maxDevices: 20 })).licenseKey;
  keys.single = (await createLicenseKey(db, { appId: app.id, label: "Una", maxDevices: 1 })).licenseKey;
  keys.trial = (await createLicenseKey(db, { appId: app.id, label: "Prueba", deviceValidityDays: 3, maxDevices: 20 })).licenseKey;
  const revoked = await createLicenseKey(db, { appId: app.id, label: "Revocada" });
  await revokeLicenseKey(db, revoked.key.id, new Date());
  keys.revoked = revoked.licenseKey;
  await new Promise<void>((resolve) => {
    server = serve({ fetch: createApiApp({ db, signer, ipHeader: "x-test-ip" }).fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      config = { apiUrl: `http://127.0.0.1:${info.port}`, appId: "cliente-web", appKey, publicKeyPem: signing.publicKeyPem, timeoutMs: 5_000 };
      resolve();
    });
  });
});

afterAll(() => server?.close());

/** Cada cliente simula un navegador distinto; cada uno con su IP para no tocar el límite de intentos. */
let ipN = 0;
function client(opts: { storage?: MemoryStorage; now?: () => number } = {}) {
  const net = netFetch();
  const ip = `10.9.0.${++ipN}`;
  const f: typeof fetch = (input, init) =>
    net.f(input, { ...init, headers: { ...(init?.headers as Record<string, string>), "x-test-ip": ip } });
  const storage = opts.storage ?? new MemoryStorage();
  return { c: new LicenseClient(config, { storage, fetch: f, ...(opts.now ? { now: opts.now } : {}) }), net: net.state, storage };
}

describe("cliente web", () => {
  it("activa, guarda el token y después comprueba sin llamar al servidor", async () => {
    const { c, net } = client();
    expect(await c.activate(` ${keys.free} `, { appVersion: "1.0.0", usageSeconds: 60 })).toEqual({ ok: true, licenseExpiresAt: null });
    expect(await c.check()).toMatchObject({ ok: true });
    expect(net.calls).toBe(1);
  });

  it("sin clave guardada → no_license", async () => {
    expect(await client().c.check()).toMatchObject({ ok: false, error: "no_license" });
  });

  it("errores del servidor con su mensaje en español y sin guardar nada", async () => {
    const a = client();
    expect(await a.c.activate("AAAAA-BBBBB-CCCCC-DDDDD-EEEEE")).toMatchObject({ ok: false, error: "invalid_key", message: "La clave de licencia no es válida." });
    expect(a.c.hasSavedLicense()).toBe(false);
    expect(await client().c.activate(keys.revoked)).toMatchObject({ error: "key_revoked", message: "Esta licencia fue anulada." });
    expect((await client().c.activate(keys.single)).ok).toBe(true);
    expect(await client().c.activate(keys.single)).toMatchObject({ error: "device_limit_reached" });
  });

  it("clave de aplicación incorrecta → invalid_client", async () => {
    const bad = new LicenseClient({ ...config, appKey: "gkapp_mala" }, { storage: new MemoryStorage() });
    expect(await bad.activate(keys.free)).toMatchObject({ ok: false, error: "invalid_client" });
  });

  it("token manipulado: se descarta y se renueva con la clave guardada", async () => {
    const { c, net, storage } = client();
    await c.activate(keys.free);
    const saved = JSON.parse(storage.getItem("gk_license")!);
    const [h, p, s] = saved.token.split(".");
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    payload.exp += 365 * 86_400;
    saved.token = [h, Buffer.from(JSON.stringify(payload)).toString("base64url"), s].join(".");
    storage.setItem("gk_license", JSON.stringify(saved));
    expect((await c.check()).ok).toBe(true);
    expect(net.calls).toBe(2);
  });

  it("sin red: sigue con el token (gracia incluida), bloquea al pasarla y no borra la clave", async () => {
    const start = Date.now();
    let now = start;
    const { c, net } = client({ now: () => now });
    await c.activate(keys.free);
    net.offline = true;
    now = start + 6 * DAY;
    expect((await c.check()).ok).toBe(true);
    now = start + 9 * DAY;
    expect((await c.check()).ok).toBe(true);
    now = start + 10.5 * DAY;
    expect(await c.check()).toMatchObject({ ok: false, error: "network_error" });
    expect(c.hasSavedLicense()).toBe(true);
    net.offline = false;
    now = Date.now();
    expect((await c.check()).ok).toBe(true);
  });

  it("licencia con vencimiento: sin red vale hasta lic_exp, sin gracia", async () => {
    const start = Date.now();
    let now = start;
    const { c, net } = client({ now: () => now });
    const r = await c.activate(keys.trial);
    expect(r.ok && r.licenseExpiresAt!.getTime() - start).toBeGreaterThan(3 * DAY - 60_000);
    net.offline = true;
    now = start + 3 * DAY - 3_600_000;
    expect((await c.check()).ok).toBe(true);
    expect(net.calls).toBe(1);
    now = start + 3 * DAY + 60_000;
    expect((await c.check()).ok).toBe(false);
  });

  it("si el servidor rechaza la clave guardada (403), la borra", async () => {
    const { c, storage } = client();
    storage.setItem("gk_license", JSON.stringify({ licenseKey: keys.revoked, token: "x.y.z" }));
    expect(await c.check()).toMatchObject({ ok: false, error: "key_revoked" });
    expect(c.hasSavedLicense()).toBe(false);
  });

  it("CORS: el navegador solo puede llamar desde el origen registrado", async () => {
    const preflight = (origin: string) =>
      fetch(`${config.apiUrl}/v1/verify`, {
        method: "OPTIONS",
        headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-app-key" },
      });
    const ok = await preflight(ORIGIN);
    expect(ok.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(ok.headers.get("access-control-allow-headers")).toContain("X-App-Key");
    expect((await preflight("http://localhost:4200")).headers.get("access-control-allow-origin")).toBeNull();
    expect((await preflight(`${ORIGIN}:8443`)).headers.get("access-control-allow-origin")).toBeNull();
  });
});
