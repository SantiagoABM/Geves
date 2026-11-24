import { serve } from "@hono/node-server";
import { createPostgresDb, createTokenSigner } from "@gk/core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApiApp } from "./app.ts";
import { loadApiEnv } from "./env.ts";

// En desarrollo lee el .env de la raíz del repo; en producción las variables vienen del sistema (systemd).
const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = loadApiEnv();
const signer = await createTokenSigner({
  privateKeyPem: env.signingPrivateKeyPem,
  kid: env.SIGNING_KEY_ID,
  issuer: env.ISSUER,
  ttlSeconds: env.TOKEN_TTL_DAYS * 86_400,
});
const app = createApiApp({
  db: createPostgresDb(env.DATABASE_URL),
  signer,
  ...(env.TRUSTED_IP_HEADER ? { ipHeader: env.TRUSTED_IP_HEADER } : {}),
});

serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  console.log(`[api] escuchando en ${env.HOST}:${info.port}`);
});
