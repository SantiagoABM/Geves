import { decodeProtectedHeader } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createTokenSigner, generateSigningKeys, verifyLicenseToken, type TokenSigner } from "../src/index.ts";

const DAY = 86_400;
const issuer = "gestor-de-claves";
const claims = { appSlug: "demo", keyId: "11111111-1111-4111-8111-111111111111", deviceId: "device-0001" };
let keys: { privateKeyPem: string; publicKeyPem: string };
let signer: TokenSigner;

beforeAll(async () => {
  keys = await generateSigningKeys();
  signer = await createTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: "k-test", issuer, ttlSeconds: 7 * DAY });
});

const opts = (o: Partial<Parameters<typeof verifyLicenseToken>[2]> = {}) => ({
  issuer,
  appSlug: "demo",
  deviceId: "device-0001",
  graceSeconds: 3 * DAY,
  ...o,
});

describe("tokens", () => {
  it("firma y verifica con la clave pública", async () => {
    const now = new Date();
    const { token, expiresAt } = await signer.sign(claims, now);
    expect(expiresAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(7 * DAY * 1000 - 1000);
    const r = await verifyLicenseToken(token, keys.publicKeyPem, opts());
    expect(r.keyId).toBe(claims.keyId);
    expect(r.deviceId).toBe("device-0001");
    expect(decodeProtectedHeader(token)).toMatchObject({ alg: "ES256", kid: "k-test" });
  });

  it("rechaza otro dispositivo", async () => {
    const { token } = await signer.sign(claims, new Date());
    await expect(verifyLicenseToken(token, keys.publicKeyPem, opts({ deviceId: "otro-device" }))).rejects.toThrow();
  });

  it("rechaza otra app", async () => {
    const { token } = await signer.sign(claims, new Date());
    await expect(verifyLicenseToken(token, keys.publicKeyPem, opts({ appSlug: "otra" }))).rejects.toThrow();
  });

  it("rechaza la firma de otro par de claves", async () => {
    const { token } = await signer.sign(claims, new Date());
    const other = await generateSigningKeys();
    await expect(verifyLicenseToken(token, other.publicKeyPem, opts())).rejects.toThrow();
  });

  it("acepta un token vencido dentro de la gracia y lo rechaza fuera", async () => {
    const issued = new Date(Date.now() - 9 * DAY * 1000); // vence hace 2 días
    const { token } = await signer.sign(claims, issued);
    await expect(verifyLicenseToken(token, keys.publicKeyPem, opts())).resolves.toBeTruthy();
    const old = await signer.sign(claims, new Date(Date.now() - 11 * DAY * 1000)); // vence hace 4 días
    await expect(verifyLicenseToken(old.token, keys.publicKeyPem, opts())).rejects.toThrow();
  });
});

describe("tokens de licencias con vencimiento", () => {
  it("el token no dura más que la licencia", async () => {
    const now = new Date("2026-11-24T12:00:00Z");
    const licenseExpiresAt = new Date(now.getTime() + 2 * DAY * 1000);
    const { expiresAt } = await signer.sign({ ...claims, licenseExpiresAt }, now);
    expect(expiresAt).toEqual(licenseExpiresAt);
  });

  it("sin vencimiento de licencia el token dura el TTL completo y no lleva lic_exp", async () => {
    const now = new Date();
    const { token } = await signer.sign({ ...claims, licenseExpiresAt: null }, now);
    const r = await verifyLicenseToken(token, keys.publicKeyPem, opts());
    expect(r.licenseExpiresAt).toBeNull();
  });

  it("vencida la licencia, el token deja de valer aunque esté en la gracia", async () => {
    const issued = new Date(Date.now() - 2 * DAY * 1000);
    const licenseExpiresAt = new Date(Date.now() - 60_000); // venció hace un minuto
    const { token } = await signer.sign({ ...claims, licenseExpiresAt }, issued);
    await expect(verifyLicenseToken(token, keys.publicKeyPem, opts())).rejects.toThrow(/venci/);
  });

  it("antes de vencer la licencia el token es válido y la informa", async () => {
    const licenseExpiresAt = new Date(Date.now() + DAY * 1000);
    const { token } = await signer.sign({ ...claims, licenseExpiresAt }, new Date());
    const r = await verifyLicenseToken(token, keys.publicKeyPem, opts());
    expect(r.licenseExpiresAt?.getTime()).toBe(Math.floor(licenseExpiresAt.getTime() / 1000) * 1000);
  });
});
