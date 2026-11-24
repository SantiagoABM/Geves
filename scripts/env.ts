import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function loadRootEnv() {
  const f = fileURLToPath(new URL("../.env", import.meta.url));
  if (existsSync(f)) process.loadEnvFile(f);
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Falta ${name} (en el .env o en el entorno). Revisa el manual.`);
    process.exit(1);
  }
  return v;
}
