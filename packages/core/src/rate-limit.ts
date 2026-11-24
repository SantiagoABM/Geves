import { sql } from "drizzle-orm";
import type { Db } from "./db.ts";
import { verificationLog } from "./schema.ts";

export const RATE_LIMIT = { perMinute: 30, failuresPer15Min: 10 };

/**
 * Cuenta en la base (no en memoria) para que el límite valga aunque la API
 * corra en varias instancias.
 */
export async function isRateLimited(db: Db, ip: string, now: Date): Promise<boolean> {
  // En SQL escrito a mano las fechas van como texto ISO: el driver real no acepta objetos Date ahí.
  const iso = (ms: number) => new Date(ms).toISOString();
  const minuteAgo = iso(now.getTime() - 60_000);
  const windowStart = iso(now.getTime() - 15 * 60_000);
  const until = iso(now.getTime());
  const [row] = await db
    .select({
      minute: sql<number>`count(*) filter (where ${verificationLog.at} > ${minuteAgo}::timestamptz)::int`,
      failures: sql<number>`count(*) filter (where ${verificationLog.result} <> 'ok')::int`,
    })
    .from(verificationLog)
    .where(
      sql`${verificationLog.ip} = ${ip} and ${verificationLog.at} > ${windowStart}::timestamptz and ${verificationLog.at} <= ${until}::timestamptz`,
    );
  return (row?.minute ?? 0) >= RATE_LIMIT.perMinute || (row?.failures ?? 0) >= RATE_LIMIT.failuresPer15Min;
}
