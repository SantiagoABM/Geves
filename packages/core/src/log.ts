import { asc, count, eq, lt, min } from "drizzle-orm";
import { AdminInputError } from "./admin.ts";
import type { Db } from "./db.ts";
import { licenseKeys, verificationLog } from "./schema.ts";

/**
 * CSV con `;` y BOM UTF-8: Excel en español lo abre en columnas y con tildes.
 * Las celdas que empiezan por = + - @ se prefijan con ' para que no se ejecuten como fórmula
 * (el device_id lo escribe el dispositivo, no tú).
 */
export function toCsv(rows: readonly (readonly string[])[]): string {
  const cell = (raw: string) => {
    const v = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return /[;"\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(";") + "\r\n").join("");
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Fecha en la hora local del PC, en un formato que Excel reconoce. */
const localStamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * Convierte el día elegido en el panel (AAAA-MM-DD, incluido) en el corte: la medianoche local siguiente.
 * Debe ser anterior a hoy, para no tocar las filas recientes que usa el límite de intentos.
 */
export function logCutoff(day: string, now: Date): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) throw new AdminInputError("Elige un día válido.");
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const cutoff = new Date(y, mo - 1, d + 1);
  if (cutoff.getFullYear() < 2000 || new Date(y, mo - 1, d).getDate() !== d) {
    throw new AdminInputError("Elige un día válido.");
  }
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (cutoff > startOfToday) throw new AdminInputError("El día elegido debe ser anterior a hoy.");
  return cutoff;
}

export async function logSummary(db: Db): Promise<{ total: number; oldest: Date | null }> {
  const [row] = await db.select({ total: count(), oldest: min(verificationLog.at) }).from(verificationLog);
  return { total: row?.total ?? 0, oldest: row?.oldest ?? null };
}

/** Todas las filas anteriores al corte, en CSV. */
export async function exportVerificationLogCsv(db: Db, before: Date): Promise<{ csv: string; rows: number }> {
  const rows = await db
    .select({
      at: verificationLog.at,
      appSlug: verificationLog.appSlug,
      keyHint: licenseKeys.keyHint,
      label: licenseKeys.label,
      deviceId: verificationLog.deviceId,
      ip: verificationLog.ip,
      result: verificationLog.result,
      usageSeconds: verificationLog.usageSeconds,
    })
    .from(verificationLog)
    .leftJoin(licenseKeys, eq(licenseKeys.id, verificationLog.keyId))
    .where(lt(verificationLog.at, before))
    .orderBy(asc(verificationLog.at), asc(verificationLog.id));
  const header = ["fecha", "app_id", "clave", "etiqueta", "dispositivo", "ip", "resultado", "uso_segundos"];
  const body = rows.map((r) => [
    localStamp(r.at),
    r.appSlug,
    r.keyHint ? `…${r.keyHint}` : "",
    r.label ?? "",
    r.deviceId,
    r.ip,
    r.result,
    r.usageSeconds === null ? "" : String(r.usageSeconds),
  ]);
  return { csv: toCsv([header, ...body]), rows: rows.length };
}

/** Borra las filas anteriores al corte. Devuelve cuántas borró. */
export async function deleteVerificationLog(db: Db, before: Date): Promise<number> {
  const deleted = await db
    .delete(verificationLog)
    .where(lt(verificationLog.at, before))
    .returning({ id: verificationLog.id });
  return deleted.length;
}
