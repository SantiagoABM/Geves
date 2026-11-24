import { serve } from "@hono/node-server";
import { createPostgresDb } from "@gk/core";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createAdminApp } from "./app.tsx";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const url = process.env.ADMIN_DATABASE_URL;
const port = Number(process.env.ADMIN_PORT ?? 4000);
if (!url) {
  console.error("[admin] Falta ADMIN_DATABASE_URL en el .env (manual, sección 5).");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("[admin] ADMIN_PORT no es un puerto válido.");
  process.exit(1);
}

const app = createAdminApp({ db: createPostgresDb(url, 3), port });

// Solo 127.0.0.1: el panel nunca escucha en la red.
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`[admin] Panel en http://127.0.0.1:${port}  (Ctrl+C para cerrar)`);
});
