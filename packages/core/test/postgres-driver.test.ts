/**
 * Pruebas con el driver real (postgres.js) hablando con PGlite por el protocolo de red de PostgreSQL.
 * PGlite directo acepta cosas que el driver real rechaza (por ejemplo, objetos Date en SQL a mano).
 * El servidor de PGlite solo admite una conexión a la vez: por eso max = 1.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createLicenseKey,
  createPostgresDb,
  deleteVerificationLog,
  exportVerificationLogCsv,
  isAllowedOrigin,
  isRateLimited,
  listLicenseKeys,
  logSummary,
  migrateDatabase,
  verifyLicense,
  type Db,
} from "../src/index.ts";

let pg: PGlite;
let server: PGLiteSocketServer;
let db: Db;

beforeAll(async () => {
  pg = new PGlite();
  // Fuera del rango dinámico (49152+), donde Windows reserva bloques de puertos y listen da EACCES.
  const port = 40_000 + Math.floor(Math.random() * 5_000);
  server = new PGLiteSocketServer({ db: pg, port, host: "127.0.0.1" });
  await server.start();
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  await migrateDatabase(url);
  db = createPostgresDb(url, 1);
});

afterAll(async () => {
  await (db as unknown as { $client: { end(): Promise<void> } })?.$client.end();
  await server?.stop();
  await pg?.close();
});

describe("con el driver real de PostgreSQL", () => {
  it("verifica, cuenta dispositivos y aplica el límite de peticiones", async () => {
    const now = new Date();
    const { app, appKey } = await createApp(db, { slug: "drv", name: "Driver", url: "https://drv.example" });
    const { licenseKey } = await createLicenseKey(db, { appId: app.id, label: "Cliente" });

    expect(await isRateLimited(db, "10.7.0.1", now)).toBe(false);
    const r = await verifyLicense(db, { appSlug: "drv", appKey, licenseKey, deviceId: "device-drv-1" }, { ip: "10.7.0.1", now });
    expect(r).toMatchObject({ ok: true, newDevice: true });
    expect(
      await verifyLicense(db, { appSlug: "drv", appKey, licenseKey, deviceId: "device-drv-2" }, { ip: "10.7.0.1", now }),
    ).toMatchObject({ ok: false, error: "device_limit_reached" });

    expect((await listLicenseKeys(db, app.id))[0]!.activeDevices).toBe(1);
    expect(await isAllowedOrigin(db, "https://drv.example")).toBe(true);
  });

  it("vencimiento por dispositivo, horas de uso y registro (CSV y borrado)", async () => {
    const now = new Date();
    const { app, appKey } = await createApp(db, { slug: "drv-exp", name: "Driver", url: "https://drv-exp.example" });
    const { licenseKey } = await createLicenseKey(db, { appId: app.id, label: "Prueba", deviceValidityDays: 7 });
    const r = await verifyLicense(
      db,
      { appSlug: "drv-exp", appKey, licenseKey, deviceId: "device-drv-9", usageSeconds: 120 },
      { ip: "10.7.0.2", now },
    );
    expect(r).toMatchObject({ ok: true, licenseExpiresAt: new Date(now.getTime() + 7 * 86_400_000) });

    const summary = await logSummary(db);
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.oldest).toBeInstanceOf(Date);
    const future = new Date(now.getTime() + 60_000);
    const { csv, rows } = await exportVerificationLogCsv(db, future);
    expect(rows).toBe(summary.total);
    expect(csv).toContain(";device-drv-9;10.7.0.2;ok;120");
    expect(await deleteVerificationLog(db, future)).toBe(summary.total);
  });
});
