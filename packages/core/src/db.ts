import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * TLS con verificación del certificado (evita intermediarios) salvo para conexiones
 * locales, como un túnel SSH, que ya va cifrado. Un `sslmode` explícito en la URL siempre manda.
 */
export function sslFor(url: string): false | "verify-full" | undefined {
  const parsed = new URL(url);
  if (parsed.searchParams.has("sslmode")) return undefined;
  return LOCAL_HOSTS.has(parsed.hostname) ? false : "verify-full";
}

export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

function client(url: string, max: number) {
  const ssl = sslFor(url);
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
