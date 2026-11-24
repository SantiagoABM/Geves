import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createLicenseKey,
  devices,
  isAllowedOrigin,
  isRateLimited,
  removeDevice,
  revokeLicenseKey,
  rotateAppKey,
  setAppActive,
  setDeviceExpiry,
  setKeyExpiration,
  setMaxDevices,
  verificationLog,
  verifyLicense,
  type Db,
  type VerifyInput,
} from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

const DAY = 86_400_000;
const now = new Date("2026-11-23T12:00:00Z");
let db: Db;
let n = 0;

beforeAll(async () => {
  ({ db } = await createTestDb());
});

/** App nueva + clave con máximo 1 dispositivo; cada fixture usa su propia IP. */
async function fixture(
  o: { maxDevices?: number; expiresAt?: Date; deviceValidityDays?: number; url?: string } = {},
) {
  const slug = `v-${++n}`;
  const ip = `10.0.0.${n}`;
  const { app, appKey } = await createApp(db, { slug, name: "Demo", url: o.url ?? "https://demo.test" });
  const { key, licenseKey } = await createLicenseKey(db, {
    appId: app.id,
    label: "Cliente",
    ...(o.maxDevices ? { maxDevices: o.maxDevices } : {}),
    ...(o.expiresAt ? { expiresAt: o.expiresAt } : {}),
    ...(o.deviceValidityDays ? { deviceValidityDays: o.deviceValidityDays } : {}),
  });
  const verify = (
    deviceId: string,
    extra: { appKey?: string; licenseKey?: string; at?: Date; input?: Partial<VerifyInput> } = {},
  ) =>
    verifyLicense(
      db,
      {
        appSlug: slug,
        appKey: extra.appKey ?? appKey,
        licenseKey: extra.licenseKey ?? licenseKey,
        deviceId,
        ...extra.input,
      },
      { ip, now: extra.at ?? now },
    );
  return { app, appKey, key, licenseKey, slug, ip, verify };
}

describe("verifyLicense: dispositivos", () => {
  it("registra el primer dispositivo y rechaza el segundo con máximo 1", async () => {
    const f = await fixture();
    expect(await f.verify("device-A")).toMatchObject({ ok: true, newDevice: true });
    expect(await f.verify("device-B")).toEqual({ ok: false, error: "device_limit_reached", maxDevices: 1 });
  });

  it("el mismo dispositivo verifica muchas veces sin gastar cupo", async () => {
    const f = await fixture();
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await f.verify("device-A"));
    expect(results.map((r) => r.ok && r.newDevice)).toEqual([true, false, false, false, false]);
    const rows = await db.select().from(devices).where(eq(devices.keyId, f.key.id));
    expect(rows.filter((r) => r.status === "active")).toHaveLength(1);
  });

  it("subir el máximo a 2 deja entrar un segundo dispositivo", async () => {
    const f = await fixture();
    await f.verify("device-A");
    await setMaxDevices(db, f.key.id, 2);
    expect(await f.verify("device-B")).toMatchObject({ ok: true, newDevice: true });
    expect(await f.verify("device-C")).toMatchObject({ ok: false, error: "device_limit_reached", maxDevices: 2 });
  });

  it("quitar un dispositivo libera su cupo y el quitado necesita cupo para volver", async () => {
    const f = await fixture();
    await f.verify("device-A");
    const [a] = await db.select().from(devices).where(eq(devices.keyId, f.key.id));
    await removeDevice(db, a!.id);
    expect(await f.verify("device-B")).toMatchObject({ ok: true, newDevice: true });
    expect(await f.verify("device-A")).toMatchObject({ ok: false, error: "device_limit_reached" });
  });

  it("guarda la IP del dispositivo", async () => {
    const f = await fixture();
    await f.verify("device-A");
    const [a] = await db.select().from(devices).where(eq(devices.keyId, f.key.id));
    expect(a).toMatchObject({ firstIp: f.ip, lastIp: f.ip });
  });
});

describe("verifyLicense: claves", () => {
  it("acepta la clave en minúsculas y sin guiones", async () => {
    const f = await fixture();
    const typed = f.licenseKey.replaceAll("-", "").toLowerCase();
    expect(await f.verify("device-A", { licenseKey: typed })).toMatchObject({ ok: true });
  });

  it("clave basura → invalid_key", async () => {
    const f = await fixture();
    expect(await f.verify("device-A", { licenseKey: "hola" })).toEqual({ ok: false, error: "invalid_key" });
  });

  it("clave de otra app → invalid_key", async () => {
    const f = await fixture();
    const other = await fixture();
    expect(await f.verify("device-A", { licenseKey: other.licenseKey })).toEqual({ ok: false, error: "invalid_key" });
  });

  it("clave revocada → key_revoked", async () => {
    const f = await fixture();
    await revokeLicenseKey(db, f.key.id, now);
    expect(await f.verify("device-A")).toEqual({ ok: false, error: "key_revoked" });
  });

  it("clave que vence justo ahora → key_expired con la fecha", async () => {
    const f = await fixture({ expiresAt: now });
    expect(await f.verify("device-A")).toEqual({ ok: false, error: "key_expired", expiresAt: now });
  });
});

const days = (d: number) => new Date(now.getTime() + d * DAY);
const deviceRow = async (keyId: string, deviceId: string) =>
  (await db.select().from(devices).where(eq(devices.keyId, keyId))).find((d) => d.deviceId === deviceId)!;

describe("verifyLicense: vencimientos", () => {
  it("sin fechas, la licencia no vence nunca", async () => {
    const f = await fixture();
    expect(await f.verify("device-A")).toMatchObject({ ok: true, licenseExpiresAt: null });
    expect(await f.verify("device-A", { at: days(3650) })).toMatchObject({ ok: true, licenseExpiresAt: null });
  });

  it("con días por dispositivo, cada uno vence N días después de activarse", async () => {
    const f = await fixture({ deviceValidityDays: 7, maxDevices: 2 });
    expect(await f.verify("device-A")).toMatchObject({ ok: true, licenseExpiresAt: days(7) });
    // El segundo se activa 3 días después: su plazo empieza ese día.
    expect(await f.verify("device-B", { at: days(3) })).toMatchObject({ ok: true, licenseExpiresAt: days(10) });
    expect(await f.verify("device-A", { at: days(8) })).toEqual({
      ok: false,
      error: "device_expired",
      expiresAt: days(7),
    });
    expect(await f.verify("device-B", { at: days(8) })).toMatchObject({ ok: true });
  });

  it("manda la fecha más próxima entre la clave y el dispositivo", async () => {
    const f = await fixture({ deviceValidityDays: 7, expiresAt: days(3) });
    expect(await f.verify("device-A")).toMatchObject({ ok: true, licenseExpiresAt: days(3) });
  });

  it("la fecha del dispositivo se puede cambiar o quitar desde el panel", async () => {
    const f = await fixture({ deviceValidityDays: 7 });
    await f.verify("device-A");
    const row = await deviceRow(f.key.id, "device-A");
    expect(await setDeviceExpiry(db, row.id, days(30))).toBe(f.key.id);
    expect(await f.verify("device-A", { at: days(20) })).toMatchObject({ ok: true, licenseExpiresAt: days(30) });
    await setDeviceExpiry(db, row.id, null);
    expect(await f.verify("device-A", { at: days(400) })).toMatchObject({ ok: true, licenseExpiresAt: null });
  });

  it("la fecha de la clave se puede cambiar o quitar desde el panel", async () => {
    const f = await fixture({ expiresAt: days(1) });
    await setKeyExpiration(db, f.key.id, { expiresAt: null, deviceValidityDays: null });
    expect(await f.verify("device-A", { at: days(5) })).toMatchObject({ ok: true, licenseExpiresAt: null });
    await setKeyExpiration(db, f.key.id, { expiresAt: days(6), deviceValidityDays: null });
    expect(await f.verify("device-A", { at: days(7) })).toMatchObject({ ok: false, error: "key_expired" });
  });

  it("los días por dispositivo nuevos solo afectan a los que se activen después", async () => {
    const f = await fixture({ maxDevices: 2 });
    await f.verify("device-A");
    await setKeyExpiration(db, f.key.id, { expiresAt: null, deviceValidityDays: 2 });
    expect(await f.verify("device-A", { at: days(5) })).toMatchObject({ ok: true, licenseExpiresAt: null });
    expect(await f.verify("device-B", { at: days(5) })).toMatchObject({ ok: true, licenseExpiresAt: days(7) });
  });

  it("quitar un dispositivo y volver a activarlo no reinicia su prueba", async () => {
    const f = await fixture({ deviceValidityDays: 7 });
    await f.verify("device-A");
    await removeDevice(db, (await deviceRow(f.key.id, "device-A")).id);
    expect(await f.verify("device-A", { at: days(2) })).toMatchObject({ ok: true, licenseExpiresAt: days(7) });
    // Vencido y quitado: vuelve como vencido sin ocupar cupo.
    await removeDevice(db, (await deviceRow(f.key.id, "device-A")).id);
    expect(await f.verify("device-A", { at: days(9) })).toMatchObject({ ok: false, error: "device_expired" });
    expect((await deviceRow(f.key.id, "device-A")).status).toBe("removed");
  });

  it("rechaza días por dispositivo fuera de 1–3650", async () => {
    const f = await fixture();
    await expect(setKeyExpiration(db, f.key.id, { expiresAt: null, deviceValidityDays: 0 })).rejects.toThrow();
    await expect(setKeyExpiration(db, f.key.id, { expiresAt: null, deviceValidityDays: 4000 })).rejects.toThrow();
  });
});

describe("verifyLicense: datos del dispositivo", () => {
  it("guarda las horas de uso en el dispositivo y en el registro", async () => {
    const f = await fixture();
    await f.verify("device-A", { input: { usageSeconds: 3600 } });
    await f.verify("device-A", { input: { usageSeconds: 7200 } });
    expect((await deviceRow(f.key.id, "device-A")).usageSeconds).toBe(7200);
    const log = await db.select().from(verificationLog).where(eq(verificationLog.appSlug, f.slug));
    expect(log.map((r) => r.usageSeconds).sort()).toEqual([3600, 7200]);
  });

  it("un campo que no se envía no borra el valor guardado", async () => {
    const f = await fixture();
    await f.verify("device-A", {
      input: { deviceName: "PC-OFICINA", platform: "Windows 11", appVersion: "1.2.0", usageSeconds: 60 },
    });
    await f.verify("device-A");
    expect(await deviceRow(f.key.id, "device-A")).toMatchObject({
      name: "PC-OFICINA",
      platform: "Windows 11",
      appVersion: "1.2.0",
      usageSeconds: 60,
    });
  });
});

describe("verifyLicense: clave de aplicación", () => {
  it("clave de app incorrecta → invalid_client", async () => {
    const f = await fixture();
    expect(await f.verify("device-A", { appKey: "gkapp_falsa" })).toEqual({ ok: false, error: "invalid_client" });
  });

  it("app desactivada → invalid_client", async () => {
    const f = await fixture();
    await setAppActive(db, f.app.id, false);
    expect(await f.verify("device-A")).toEqual({ ok: false, error: "invalid_client" });
  });

  it("tras rotar, la clave vieja vale 30 días y la nueva siempre", async () => {
    const f = await fixture();
    const newKey = await rotateAppKey(db, f.app.id, now);
    expect(await f.verify("device-A", { appKey: f.appKey, at: new Date(now.getTime() + 29 * DAY) })).toMatchObject({
      ok: true,
    });
    expect(await f.verify("device-A", { appKey: f.appKey, at: new Date(now.getTime() + 31 * DAY) })).toEqual({
      ok: false,
      error: "invalid_client",
    });
    expect(await f.verify("device-A", { appKey: newKey, at: new Date(now.getTime() + 31 * DAY) })).toMatchObject({
      ok: true,
    });
  });
});

describe("registro y límites", () => {
  it("cada verificación deja una fila en el log con su resultado", async () => {
    const f = await fixture();
    await f.verify("device-A");
    await f.verify("device-B");
    const rows = await db.select().from(verificationLog).where(eq(verificationLog.appSlug, f.slug));
    expect(rows.map((r) => r.result).sort()).toEqual(["device_limit_reached", "ok"]);
  });

  it("limita a 30 peticiones por minuto por IP", async () => {
    const ip = "10.9.0.1";
    const rows = Array.from({ length: 30 }, () => ({ appSlug: "x", deviceId: "d", ip, result: "ok", at: now }));
    await db.insert(verificationLog).values(rows);
    expect(await isRateLimited(db, ip, now)).toBe(true);
    expect(await isRateLimited(db, "10.9.0.2", now)).toBe(false);
    expect(await isRateLimited(db, ip, new Date(now.getTime() + 61_000))).toBe(false);
  });

  it("limita a 10 fallos en 15 minutos por IP", async () => {
    const ip = "10.9.0.3";
    const rows = Array.from({ length: 10 }, (_, i) => ({
      appSlug: "x",
      deviceId: "d",
      ip,
      result: "invalid_key",
      at: new Date(now.getTime() - i * 60_000),
    }));
    await db.insert(verificationLog).values(rows);
    expect(await isRateLimited(db, ip, now)).toBe(true);
  });
});

describe("isAllowedOrigin", () => {
  it("acepta el origen de una app activa y rechaza otros", async () => {
    await fixture({ url: "https://miapp.example/login" });
    expect(await isAllowedOrigin(db, "https://miapp.example")).toBe(true);
    expect(await isAllowedOrigin(db, "https://otra.example")).toBe(false);
  });
});
