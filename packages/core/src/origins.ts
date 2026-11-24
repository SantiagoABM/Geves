import { eq } from "drizzle-orm";
import type { Db } from "./db.ts";
import { apps } from "./schema.ts";

/** Un navegador solo puede llamar a la API desde el origen de una app registrada y activa. */
export async function isAllowedOrigin(db: Db, origin: string): Promise<boolean> {
  const rows = await db.select({ url: apps.url }).from(apps).where(eq(apps.active, true));
  return rows.some((r) => {
    try {
      return new URL(r.url).origin === origin;
    } catch {
      return false;
    }
  });
}
