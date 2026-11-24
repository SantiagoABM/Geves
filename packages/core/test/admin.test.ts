import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  AdminInputError,
  apps,
  createApp,
  createLicenseKey,
  hashSecret,
  licenseKeys,
  listApps,
  listLicenseKeys,
  removeDevice,
  revokeLicenseKey,
  verifyLicense,
  type Db,
} from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

let db: Db;
let n = 0;
const slug = () => `app-${++n}`;

beforeAll(async () => {
  ({ db } = await createTestDb());
});

describe("createApp", () => {
  it("devuelve la clave de app una vez y guarda solo su hash", async () => {
    const { app, appKey } = await createApp(db, { slug: slug(), name: "Demo", url: "https://demo.test" });
    expect(appKey.startsWith("gkapp_")).toBe(true);
    const [row] = await db.select().from(apps).where(eq(apps.id, app.id));
    expect(row!.apiKeyHash).toBe(hashSecret(appKey));
    expect(JSON.stringify(row)).not.toContain(appKey);
  });

  it("rechaza slugs con espacios o mayúsculas", async () => {
    await expect(createApp(db, { slug: "Mi App", name: "x", url: "https://x.test" })).rejects.toBeInstanceOf(
      AdminInputError,
    );
  });

  it("rechaza URLs que no son http(s)", async () => {
    await expect(createApp(db, { slug: slug(), name: "x", url: "ftp://x" })).rejects.toBeInstanceOf(AdminInputError);
  });

  it("rechaza un slug repetido con un error legible", async () => {
    const s = slug();
    await createApp(db, { slug: s, name: "x", url: "https://x.test" });
    await expect(createApp(db, { slug: s, name: "y", url: "https://y.test" })).rejects.toBeInstanceOf(AdminInputError);
  });
});

describe("createLicenseKey", () => {
  it("usa 1 dispositivo por defecto y guarda solo el hash", async () => {
    const { app } = await createApp(db, { slug: slug(), name: "Demo", url: "https://demo.test" });
    const { key, licenseKey } = await createLicenseKey(db, { appId: app.id, label: "Cliente" });
    expect(key.maxDevices).toBe(1);
    const [row] = await db.select().from(licenseKeys).where(eq(licenseKeys.id, key.id));
    expect(row!.keyHash).toBe(hashSecret(licenseKey.replaceAll("-", "")));
  });

  it("rechaza 0 dispositivos", async () => {
    const { app } = await createApp(db, { slug: slug(), name: "Demo", url: "https://demo.test" });
    await expect(createLicenseKey(db, { appId: app.id, label: "x", maxDevices: 0 })).rejects.toBeInstanceOf(
      AdminInputError,
    );
  });
});

describe("listApps", () => {
  it("listApps cuenta claves activas y dispositivos activos", async () => {
    const s = slug();
    const now = new Date();
    const { app, appKey } = await createApp(db, { slug: s, name: "Cifras", url: "https://cifras.test" });
    const { licenseKey } = await createLicenseKey(db, { appId: app.id, label: "Activa", maxDevices: 5 });
    const revoked = await createLicenseKey(db, { appId: app.id, label: "Revocada", maxDevices: 5 });
    for (const d of ["device-c001", "device-c002", "device-c003"]) {
      await verifyLicense(db, { appSlug: s, appKey, licenseKey, deviceId: d }, { ip: "9.9.9.2", now });
    }
    await verifyLicense(db, { appSlug: s, appKey, licenseKey: revoked.licenseKey, deviceId: "device-c009" }, { ip: "9.9.9.2", now });
    await revokeLicenseKey(db, revoked.key.id, now);
    const gone = await db.query.devices.findFirst({ where: (t, { eq }) => eq(t.deviceId, "device-c003") });
    await removeDevice(db, gone!.id);
    const empty = await createApp(db, { slug: slug(), name: "Vacía", url: "https://vacia.test" });

    const list = await listApps(db);
    expect(list.find((a) => a.id === app.id)).toMatchObject({ activeKeys: 1, activeDevices: 2 });
    expect(list.find((a) => a.id === empty.app.id)).toMatchObject({ activeKeys: 0, activeDevices: 0 });
  });
});

describe("listLicenseKeys", () => {
  it("cuenta dispositivos activos", async () => {
    const s = slug();
    const { app, appKey } = await createApp(db, { slug: s, name: "Demo", url: "https://demo.test" });
    const { key, licenseKey } = await createLicenseKey(db, { appId: app.id, label: "Cliente" });
    await verifyLicense(db, { appSlug: s, appKey, licenseKey, deviceId: "device-0001" }, { ip: "9.9.9.1", now: new Date() });
    expect((await listLicenseKeys(db, app.id))[0]!.activeDevices).toBe(1);
    const detail = await db.query.devices.findFirst({ where: (t, { eq }) => eq(t.deviceId, "device-0001") });
    await removeDevice(db, detail!.id);
    expect((await listLicenseKeys(db, app.id)).find((k) => k.id === key.id)!.activeDevices).toBe(0);
  });
});
