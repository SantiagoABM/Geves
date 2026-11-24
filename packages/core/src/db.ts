import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * TLS con verificación del certificado (evita intermediarios) salvo para conexiones
 * locales, como un túnel SSH, que ya va cifrado. Un `sslmode` explícito en la URL siempre manda.
 * Con `caPem` (el certificado raíz de Supabase, que no es de una autoridad pública) se verifica
 * el servidor contra ese certificado, nombre de host incluido.
 */
export function sslFor(
  url: string,
  caPem?: string,
): false | "verify-full" | { ca: string; rejectUnauthorized: true } | undefined {
  const parsed = new URL(url);
  if (parsed.searchParams.has("sslmode")) return undefined;
  if (caPem) return { ca: caPem, rejectUnauthorized: true };
  return LOCAL_HOSTS.has(parsed.hostname) ? false : "verify-full";
}

/** Certificado raíz de la base, si `DATABASE_CA_FILE` apunta a uno (Supabase). */
function caFromEnv(): string | undefined {
  const file = process.env.DATABASE_CA_FILE;
  if (!file) return undefined;
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`No se pudo leer DATABASE_CA_FILE (${file}).`);
  }
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

function client(url: string, max: number) {
  const ssl = sslFor(url, caFromEnv());
  return postgres(url, { max, onnotice: () => {}, ...(ssl === undefined ? {} : { ssl }) });
}

export function createPostgresDb(url: string, max = 10): Db {
  return drizzle(client(url, max), { schema }) as unknown as Db;
}

/** Aplica las migraciones pendientes y cierra la conexión. Usar con el usuario dueño de la base. */
export async function migrateDatabase(url: string): Promise<void> {
  const c = client(url, 1);
  try {
    await migrate(drizzle(c), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await c.end();
  }
}
