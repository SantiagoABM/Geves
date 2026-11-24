import {
  createApp,
  createLicenseKey,
  createTokenSigner,
  devices,
  generateSigningKeys,
  verifyLicenseToken,
  type Db,
} from "@gk/core";
import { createTestDb } from "@gk/core/testing";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "../src/app.ts";

const issuer = "gestor-de-claves";
let db: Db;
let api: ReturnType<typeof createApiApp>;
let publicKeyPem: string;
let n = 0;

beforeAll(async () => {
  ({ db } = await createTestDb());
  const keys = await generateSigningKeys();
  publicKeyPem = keys.publicKeyPem;
  const signer = await createTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: "k1", issuer, ttlSeconds: 7 * 86_400 });
  api = createApiApp({ db, signer, ipHeader: "x-test-ip" });
});

async function fixture(o: { expiresAt?: Date; deviceValidityDays?: number } = {}) {
  const slug = `api-${++n}`;
  const ip = `10.1.0.${n}`;
  const { appKey } = await createApp(db, { slug, name: "Demo", url: `https://${slug}.example` });
  const { key, licenseKey } = await createLicenseKey(db, {
    appId: (await db.query.apps.findFirst({ where: (a, { eq }) => eq(a.slug, slug) }))!.id,
    label: "Cliente",
    ...o,
  });
  const call = (body: unknown, headers: Record<string, string> = {}) =>
    api.request("/v1/verify", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": appKey, "x-test-ip": ip, ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  const body = (deviceId: string) => ({ app_id: slug, license_key: licenseKey, device_id: deviceId, platform: "test" });
  return { slug, ip, key, licenseKey, appKey, call, body };
}

async function json(res: Response) {
  const text = await res.text();
  expect(text).not.toContain("stack");
  expect(text).not.toMatch(/\bat [\w.]+ \(/);
  return JSON.parse(text);
}

describe("POST /v1/verify", () => {
  it("devuelve un token válido para este dispositivo", async () => {
    const f = await fixture();
    const res = await f.call(f.body("device-0001"));
    expect(res.status).toBe(200);
    const data = await json(res);
    expect(data.ok).toBe(true);
    const t = await verifyLicenseToken(data.token, publicKeyPem, {
      issuer,
      appSlug: f.slug,
      deviceId: "device-0001",
      graceSeconds: 0,
    });
    expect(t.keyId).toBe(f.key.id);
    expect(new Date(data.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("rechaza un segundo dispositivo con 403", async () => {
    const f = await fixture();
    await f.call(f.body("device-0001"));
    const res = await f.call(f.body("device-0002"));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({
      ok: false,
      error: "device_limit_reached",
      max_devices: 1,
      message: "Esta licencia ya se usa en el máximo de dispositivos permitido (1).",
    });
  });

  it("sin X-App-Key → 401 invalid_client con mensaje", async () => {
    const f = await fixture();
    const res = await f.call(f.body("device-0001"), { "x-app-key": "" });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({
      ok: false,
      error: "invalid_client",
      message: "Esta aplicación no está autorizada para verificar licencias.",
    });
  });

  it("sin vencimiento → license_expires_at null", async () => {
    const f = await fixture();
    const data = await json(await f.call(f.body("device-0001")));
    expect(data.license_expires_at).toBeNull();
  });

  it("licencia que vence pronto → el token vence con ella", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000);
    const f = await fixture({ expiresAt });
    const data = await json(await f.call(f.body("device-0001")));
    expect(data.license_expires_at).toBe(expiresAt.toISOString());
    expect(new Date(data.expires_at).getTime()).toBe(Math.floor(expiresAt.getTime() / 1000) * 1000);
  });

  it("clave vencida → 403 key_expired con fecha y motivo", async () => {
    const expiresAt = new Date(Date.now() - 60_000);
    const f = await fixture({ expiresAt });
    const res = await f.call(f.body("device-0001"));
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({
      ok: false,
      error: "key_expired",
      expires_at: expiresAt.toISOString(),
      message: "Esta licencia venció.",
    });
  });

  it("dispositivo vencido → 403 device_expired con fecha y motivo", async () => {
    const f = await fixture({ deviceValidityDays: 7 });
    await f.call(f.body("device-0001"));
    await db
      .update(devices)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(devices.keyId, f.key.id));
    const res = await f.call(f.body("device-0001"));
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({
      ok: false,
      error: "device_expired",
      message: "El periodo de uso de esta licencia en este dispositivo terminó.",
    });
  });

  it("campos opcionales raros no hacen fallar la verificación", async () => {
    const f = await fixture();
    const res = await f.call({
      ...f.body("device-0001"),
      device_name: "N".repeat(500),
      app_version: 12,
      usage_seconds: "mucho",
    });
    expect(res.status).toBe(200);
    const [d] = await db.select().from(devices).where(eq(devices.keyId, f.key.id));
    expect(d!.name).toHaveLength(100);
    expect(d!.appVersion).toBeNull();
    expect(d!.usageSeconds).toBeNull();
  });

  it("guarda usage_seconds en el dispositivo", async () => {
    const f = await fixture();
    await f.call({ ...f.body("device-0001"), usage_seconds: 5400 });
    const [d] = await db.select().from(devices).where(eq(devices.keyId, f.key.id));
    expect(d!.usageSeconds).toBe(5400);
  });

  it("cuerpo que no es JSON → 400", async () => {
    const f = await fixture();
    const res = await f.call("no json");
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("bad_request");
  });

  it("device_id de 500 caracteres → 400", async () => {
    const f = await fixture();
    const res = await f.call(f.body("d".repeat(500)));
    expect(res.status).toBe(400);
  });

  it("cuerpo de 10 KB → 413", async () => {
    const f = await fixture();
    const res = await f.call({ ...f.body("device-0001"), padding: "x".repeat(10_000) });
    expect(res.status).toBe(413);
    expect((await json(res)).error).toBe("payload_too_large");
  });

  it("la petición 31 de la misma IP en un minuto → 429 con Retry-After", async () => {
    const f = await fixture();
    for (let i = 0; i < 30; i++) await f.call(f.body("device-0001"));
    const res = await f.call(f.body("device-0001"));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });
});

describe("CORS y rutas", () => {
  it("preflight desde el origen de la app → 204 con Allow-Origin", async () => {
    const f = await fixture();
    const res = await api.request("/v1/verify", {
      method: "OPTIONS",
      headers: { origin: `https://${f.slug}.example`, "access-control-request-method": "POST" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(`https://${f.slug}.example`);
  });

  it("preflight desde otro origen → sin Allow-Origin", async () => {
    const res = await api.request("/v1/verify", {
      method: "OPTIONS",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("GET /health → ok", async () => {
    const res = await api.request("/health");
    expect(await res.json()).toEqual({ ok: true });
  });

  it("no hay rutas de administración", async () => {
    expect((await api.request("/admin")).status).toBe(404);
  });
});
