import { serve, type ServerType } from "@hono/node-server";
import {
  createApp,
  createLicenseKey,
  createTokenSigner,
  devices,
  generateSigningKeys,
  verificationLog,
  type Db,
  type TokenSigner,
} from "@gk/core";
import { createTestDb } from "@gk/core/testing";
import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiApp } from "../apps/api/src/app.ts";
import { checkLicense } from "./node-client.ts";

const issuer = "gestor-de-claves";
let db: Db;
let server: ServerType;
let apiUrl: string;
let publicKeyPem: string;
let appKey: string;
let licenseKey: string;
let signer: TokenSigner;
let appId: string;

beforeAll(async () => {
  ({ db } = await createTestDb());
  const keys = await generateSigningKeys();
  publicKeyPem = keys.publicKeyPem;
  signer = await createTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: "k1", issuer, ttlSeconds: 7 * 86_400 });
  const created = await createApp(db, { slug: "cliente-node", name: "Cliente", url: "https://cliente.example" });
  appKey = created.appKey;
  appId = created.app.id;
  ({ licenseKey } = await createLicenseKey(db, { appId: created.app.id, label: "Prueba" }));
  const app = createApiApp({ db, signer });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      apiUrl = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

function options(storePath: string, asked: { n: number }) {
  return {
    apiUrl,
    appSlug: "cliente-node",
    appKey,
    publicKeyPem,
    issuer,
    storePath,
    deviceId: "device-node-0001",
    askLicenseKey: async () => {
      asked.n++;
      return licenseKey;
    },
  };
}

describe("checkLicense", () => {
  it("pide la clave la primera vez y luego trabaja sin red", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const asked = { n: 0 };
    expect(await checkLicense(options(store, asked))).toEqual({ ok: true });
    expect(asked.n).toBe(1);

    // Con la API caída, el token guardado sigue siendo válido.
    expect(await checkLicense({ ...options(store, asked), apiUrl: "http://127.0.0.1:1" })).toEqual({ ok: true });
    expect(asked.n).toBe(1);
  });

  it("si el token guardado está manipulado, lo descarta y revalida con el servidor", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const asked = { n: 0 };
    await checkLicense(options(store, asked));
    const saved = JSON.parse(readFileSync(store, "utf8"));
    const [h, p, s] = saved.token.split(".");
    const forged = JSON.parse(Buffer.from(p, "base64url").toString());
    forged.exp += 365 * 86_400;
    saved.token = [h, Buffer.from(JSON.stringify(forged)).toString("base64url"), s].join(".");
    writeFileSync(store, JSON.stringify(saved));
    expect(await checkLicense(options(store, asked))).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(store, "utf8")).token).not.toBe(saved.token);

    // Manipulado y sin servidor: no se acepta.
    writeFileSync(store, JSON.stringify(saved));
    expect(await checkLicense({ ...options(store, asked), apiUrl: "http://127.0.0.1:1" })).toEqual({
      ok: false,
      error: "network_error",
      message: "No se pudo conectar con el servidor de licencias. Revisa tu conexión.",
    });
  });

  it("si la clave guardada deja de valer, borra lo guardado y la pide de nuevo", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const asked = { n: 0 };
    await checkLicense(options(store, asked));
    const saved = JSON.parse(readFileSync(store, "utf8"));
    writeFileSync(store, JSON.stringify({ ...saved, token: "x.y.z", licenseKey: "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" }));
    expect(await checkLicense(options(store, asked))).toEqual({ ok: true });
    expect(asked.n).toBe(2);
  });

  it("devuelve el error del servidor y su motivo si la clave no vale", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const r = await checkLicense({ ...options(store, { n: 0 }), askLicenseKey: async () => "ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ" });
    expect(r).toEqual({ ok: false, error: "invalid_key", message: "La clave de licencia no es válida." });
  });

  it("envía las horas de uso", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const { licenseKey: own } = await createLicenseKey(db, { appId, label: "Uso" });
    const o = {
      ...options(store, { n: 0 }),
      deviceId: "device-node-uso",
      askLicenseKey: async () => own,
      usageSeconds: () => 7200,
    };
    expect(await checkLicense(o)).toEqual({ ok: true });
    const [d] = await db.select().from(devices).where(eq(devices.deviceId, "device-node-uso"));
    expect(d!.usageSeconds).toBe(7200);
  });
});

describe("checkLicense con licencias que vencen", () => {
  const deviceId = "device-node-trial";

  it("vencida la licencia, no funciona aunque el token esté en la gracia y no haya red", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const { token } = await signer.sign(
      { appSlug: "cliente-node", keyId: "11111111-1111-4111-8111-111111111111", deviceId, licenseExpiresAt: new Date(Date.now() - 60_000) },
      new Date(Date.now() - 86_400_000),
    );
    writeFileSync(store, JSON.stringify({ licenseKey, token }));
    const r = await checkLicense({ ...options(store, { n: 0 }), deviceId, apiUrl: "http://127.0.0.1:1" });
    expect(r).toMatchObject({ ok: false, error: "network_error" });
  });

  it("si el token ya llega al vencimiento de la licencia, no pide renovación en cada arranque", async () => {
    const store = join(mkdtempSync(join(tmpdir(), "gk-")), "license.json");
    const { licenseKey: trialKey } = await createLicenseKey(db, {
      appId: appId,
      label: "Prueba 1 día",
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    const o = { ...options(store, { n: 0 }), deviceId, askLicenseKey: async () => trialKey };
    expect(await checkLicense(o)).toEqual({ ok: true });
    const calls = async () => (await db.select().from(verificationLog).where(eq(verificationLog.deviceId, deviceId))).length;
    const before = await calls();
    expect(await checkLicense(o)).toEqual({ ok: true });
    expect(await calls()).toBe(before);
  });
});
