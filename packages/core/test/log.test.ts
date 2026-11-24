import { beforeAll, describe, expect, it } from "vitest";
import {
  createApp,
  createLicenseKey,
  deleteVerificationLog,
  exportVerificationLogCsv,
  logCutoff,
  logSummary,
  toCsv,
  verificationLog,
  type Db,
} from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

let db: Db;
const at = (s: string) => new Date(`${s}T10:00:00`); // hora local, como el panel

beforeAll(async () => {
  ({ db } = await createTestDb());
  const { app } = await createApp(db, { slug: "log-app", name: "Demo", url: "https://demo.test" });
  const { key } = await createLicenseKey(db, { appId: app.id, label: "Cliente Ana" });
  await db.insert(verificationLog).values([
    { keyId: key.id, appSlug: "log-app", deviceId: "device-0001", ip: "1.1.1.1", result: "ok", usageSeconds: 3600, at: at("2026-10-01") },
    { keyId: key.id, appSlug: "log-app", deviceId: "device-0002", ip: "2.2.2.2", result: "device_limit_reached", at: at("2026-10-15") },
    { keyId: null, appSlug: "log-app", deviceId: "=HYPERLINK(1)", ip: "3.3.3.3", result: "invalid_key", at: at("2026-11-20") },
  ]);
});

describe("toCsv", () => {
  it("separa con ; y escapa comillas, saltos de línea y fórmulas", () => {
    const csv = toCsv([
      ["a", 'di "hola"', "x;y"],
      ["=1+1", "+3", "línea\nnueva"],
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.slice(1)).toBe('a;"di ""hola""";"x;y"\r\n\'=1+1;\'+3;"línea\nnueva"\r\n');
  });
});

describe("logCutoff", () => {
  const now = new Date("2026-11-24T15:00:00");

  it("incluye el día elegido completo (hasta la medianoche siguiente, hora local)", () => {
    expect(logCutoff("2026-10-31", now)).toEqual(new Date("2026-11-01T00:00:00"));
  });

  it("no permite hoy ni días futuros, ni fechas mal escritas", () => {
    expect(() => logCutoff("2026-11-24", now)).toThrow(/anterior a hoy/);
    expect(() => logCutoff("2026-12-01", now)).toThrow(/anterior a hoy/);
    expect(() => logCutoff("31/10/2026", now)).toThrow();
    expect(() => logCutoff("", now)).toThrow();
  });
});

describe("exportar y borrar el registro", () => {
  it("resume cuántas filas hay y la más antigua", async () => {
    expect(await logSummary(db)).toEqual({ total: 3, oldest: at("2026-10-01") });
  });

  it("exporta solo lo anterior al corte, con la etiqueta de la clave", async () => {
    const { csv, rows } = await exportVerificationLogCsv(db, new Date("2026-11-01T00:00:00"));
    expect(rows).toBe(2);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("fecha;app_id;clave;etiqueta;dispositivo;ip;resultado;uso_segundos");
    expect(lines[1]).toMatch(/^2026-10-01 10:00:00;log-app;…\w{4};Cliente Ana;device-0001;1\.1\.1\.1;ok;3600$/);
    expect(lines[2]).toMatch(/;device_limit_reached;$/);
  });

  it("escapa un device_id con fórmula", async () => {
    const { csv } = await exportVerificationLogCsv(db, new Date("2026-12-01T00:00:00"));
    expect(csv).toContain(";'=HYPERLINK(1);");
  });

  it("borra solo lo anterior al corte y dice cuántas filas", async () => {
    expect(await deleteVerificationLog(db, new Date("2026-11-01T00:00:00"))).toBe(2);
    expect(await logSummary(db)).toEqual({ total: 1, oldest: at("2026-11-20") });
  });
});
