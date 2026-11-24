// API local con base en memoria y claves de prueba, para probar los clientes (p. ej. el de Flutter).
// Uso: npx tsx examples/test-api.ts <archivo-json-de-salida> [puerto]
import { serve } from "@hono/node-server";
import { createApp, createLicenseKey, createTokenSigner, generateSigningKeys, revokeLicenseKey } from "@gk/core";
import { createTestDb } from "@gk/core/testing";
import { writeFileSync } from "node:fs";
import { createApiApp } from "../apps/api/src/app.ts";

const out = process.argv[2]!;
const port = Number(process.argv[3] ?? 3300);
const { db } = await createTestDb();
const keys = await generateSigningKeys();
const signer = await createTokenSigner({ privateKeyPem: keys.privateKeyPem, kid: "k-test", issuer: "gestor-de-claves", ttlSeconds: 7 * 86_400 });
const { app, appKey } = await createApp(db, { slug: "prueba-cliente", name: "Prueba", url: `http://localhost:${port + 1}` });
const now = new Date();
const normal = await createLicenseKey(db, { appId: app.id, label: "Normal", maxDevices: 1 });
const revoked = await createLicenseKey(db, { appId: app.id, label: "Revocada" });
await revokeLicenseKey(db, revoked.key.id, now);
const shortExp = await createLicenseKey(db, { appId: app.id, label: "Vence en 90 s", expiresAt: new Date(now.getTime() + 90_000) });
const trial = await createLicenseKey(db, { appId: app.id, label: "Prueba 3 días", deviceValidityDays: 3, maxDevices: 10 });
const free = await createLicenseKey(db, { appId: app.id, label: "Sin vencimiento", maxDevices: 10 });

serve({ fetch: createApiApp({ db, signer }).fetch, port, hostname: "127.0.0.1" }, () => {
  writeFileSync(
    out,
    JSON.stringify({
      apiUrl: `http://127.0.0.1:${port}`,
      webOrigin: `http://localhost:${port + 1}`,
      appId: "prueba-cliente",
      appKey,
      publicKeyPem: keys.publicKeyPem,
      keys: { normal: normal.licenseKey, revoked: revoked.licenseKey, shortExp: shortExp.licenseKey, trial: trial.licenseKey, free: free.licenseKey },
    }),
  );
  console.log(`API de prueba en http://127.0.0.1:${port}`);
});
