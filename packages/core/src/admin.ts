import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { generateAppKey, generateLicenseKey, hashSecret, normalizeLicenseKey, secretHint } from "./crypto.ts";
import type { Db } from "./db.ts";
import { apps, devices, licenseKeys, type AppRow, type DeviceRow, type LicenseKeyRow } from "./schema.ts";

/** Error de entrada del panel: su mensaje se puede mostrar tal cual al administrador. */
export class AdminInputError extends Error {}

export const APP_KEY_TRANSITION_DAYS = 30;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s: string) => UUID_RE.test(s);

function requireText(value: string, field: string, max = 100): string {
  const v = value.trim();
  if (!v || v.length > max) throw new AdminInputError(`${field}: obligatorio, máximo ${max} caracteres.`);
  return v;
}

function requireMaxDevices(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new AdminInputError("Máximo de dispositivos: un número entero entre 1 y 1000.");
  }
  return n;
}

function requireValidityDays(n: number | null | undefined): number | null {
  if (n === null || n === undefined) return null;
  if (!Number.isInteger(n) || n < 1 || n > 3650) {
    throw new AdminInputError("Días por dispositivo: un número entero entre 1 y 3650, o vacío para no limitar.");
  }
  return n;
}

function requireDate(d: Date | null | undefined): Date | null {
  if (!d) return null;
  if (Number.isNaN(d.getTime())) throw new AdminInputError("Fecha de vencimiento no válida.");
  return d;
}

function requireId(id: string): string {
  if (!isUuid(id)) throw new AdminInputError("Identificador no válido.");
  return id;
}

export async function createApp(
  db: Db,
  i: { slug: string; name: string; url: string },
): Promise<{ app: AppRow; appKey: string }> {
  const slug = i.slug.trim();
  if (!SLUG_RE.test(slug)) {
    throw new AdminInputError("Identificador de app: 2-49 caracteres, minúsculas, números y guiones.");
  }
  const name = requireText(i.name, "Nombre");
  let url: URL;
  try {
    url = new URL(i.url.trim());
  } catch {
    throw new AdminInputError("URL no válida.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new AdminInputError("La URL debe ser http o https.");
  if ((await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug))).length) {
    throw new AdminInputError("Ya existe una app con ese identificador.");
  }
  const appKey = generateAppKey();
  const [app] = await db
    .insert(apps)
    .values({ slug, name, url: url.toString(), apiKeyHash: hashSecret(appKey), apiKeyHint: secretHint(appKey) })
    .returning();
  return { app: app!, appKey };
}

/** Genera una clave de app nueva; la anterior sigue valiendo 30 días. */
export async function rotateAppKey(db: Db, appId: string, now: Date): Promise<string> {
  const app = await getApp(db, appId);
  if (!app) throw new AdminInputError("La app no existe.");
  const appKey = generateAppKey();
  await db
    .update(apps)
    .set({
      prevApiKeyHash: app.apiKeyHash,
      prevApiKeyExpiresAt: new Date(now.getTime() + APP_KEY_TRANSITION_DAYS * 86_400_000),
      apiKeyHash: hashSecret(appKey),
      apiKeyHint: secretHint(appKey),
    })
    .where(eq(apps.id, app.id));
  return appKey;
}

export async function setAppActive(db: Db, appId: string, active: boolean): Promise<void> {
  await db.update(apps).set({ active }).where(eq(apps.id, requireId(appId)));
}

export async function createLicenseKey(
  db: Db,
  i: {
    appId: string;
    label: string;
    maxDevices?: number;
    expiresAt?: Date | null;
    /** Cada dispositivo vence N días después de activarse. Vacío = sin límite. */
    deviceValidityDays?: number | null;
  },
): Promise<{ key: LicenseKeyRow; licenseKey: string }> {
  const app = await getApp(db, i.appId);
  if (!app) throw new AdminInputError("La app no existe.");
  const label = requireText(i.label, "Etiqueta");
  const maxDevices = requireMaxDevices(i.maxDevices ?? 1);
  const expiresAt = requireDate(i.expiresAt);
  const deviceValidityDays = requireValidityDays(i.deviceValidityDays);
  const licenseKey = generateLicenseKey();
  const normalized = normalizeLicenseKey(licenseKey)!;
  const [key] = await db
    .insert(licenseKeys)
    .values({
      appId: app.id,
      keyHash: hashSecret(normalized),
      keyHint: secretHint(normalized),
      label,
      maxDevices,
      expiresAt,
      deviceValidityDays,
    })
    .returning();
  return { key: key!, licenseKey };
}

/**
 * Cambia o quita el vencimiento fijo de la clave y los días por dispositivo.
 * Los días por dispositivo solo afectan a los dispositivos que se activen después.
 */
export async function setKeyExpiration(
  db: Db,
  keyId: string,
  i: { expiresAt: Date | null; deviceValidityDays: number | null },
): Promise<void> {
  await db
    .update(licenseKeys)
    .set({ expiresAt: requireDate(i.expiresAt), deviceValidityDays: requireValidityDays(i.deviceValidityDays) })
    .where(eq(licenseKeys.id, requireId(keyId)));
}

/** Cambia o quita (`null`) el vencimiento de un dispositivo. Devuelve el id de su clave. */
export async function setDeviceExpiry(db: Db, deviceRowId: string, expiresAt: Date | null): Promise<string | undefined> {
  const [row] = await db
    .update(devices)
    .set({ expiresAt: requireDate(expiresAt) })
    .where(eq(devices.id, requireId(deviceRowId)))
    .returning({ keyId: devices.keyId });
  return row?.keyId;
}

export async function revokeLicenseKey(db: Db, keyId: string, now: Date): Promise<void> {
  await db
    .update(licenseKeys)
    .set({ status: "revoked", revokedAt: now })
    .where(and(eq(licenseKeys.id, requireId(keyId)), eq(licenseKeys.status, "active")));
}

export async function setMaxDevices(db: Db, keyId: string, n: number): Promise<void> {
  await db
    .update(licenseKeys)
    .set({ maxDevices: requireMaxDevices(n) })
    .where(eq(licenseKeys.id, requireId(keyId)));
}

/** Quita el dispositivo y libera su cupo. Devuelve el id de la clave para volver a su página. */
export async function removeDevice(db: Db, deviceRowId: string): Promise<string | undefined> {
  const [row] = await db
    .update(devices)
    .set({ status: "removed" })
    .where(eq(devices.id, requireId(deviceRowId)))
    .returning({ keyId: devices.keyId });
  return row?.keyId;
}

export type AppSummary = AppRow & { activeKeys: number; activeDevices: number };

export async function listApps(db: Db): Promise<AppSummary[]> {
  return db
    .select({
      ...getTableColumns(apps),
      // Columna externa cualificada a mano, como en listLicenseKeys.
      activeKeys: sql<number>`(select count(*)::int from license_keys k where k.app_id = "apps"."id" and k.status = 'active')`,
      activeDevices: sql<number>`(select count(*)::int from devices d join license_keys k on k.id = d.key_id
        where k.app_id = "apps"."id" and k.status = 'active' and d.status = 'active')`,
    })
    .from(apps)
    .orderBy(desc(apps.createdAt));
}

export async function getApp(db: Db, appId: string): Promise<AppRow | undefined> {
  if (!isUuid(appId)) return undefined;
  const [row] = await db.select().from(apps).where(eq(apps.id, appId));
  return row;
}

export type LicenseKeySummary = LicenseKeyRow & { activeDevices: number };

export async function listLicenseKeys(db: Db, appId: string): Promise<LicenseKeySummary[]> {
  if (!isUuid(appId)) return [];
  return db
    .select({
      ...getTableColumns(licenseKeys),
      // Columna externa cualificada a mano: sin el nombre de la tabla, "id" se resolvería contra devices.
      activeDevices: sql<number>`(select count(*)::int from devices d where d.key_id = "license_keys"."id" and d.status = 'active')`,
    })
    .from(licenseKeys)
    .where(eq(licenseKeys.appId, appId))
    .orderBy(desc(licenseKeys.createdAt));
}

export async function getLicenseKeyDetail(
  db: Db,
  keyId: string,
): Promise<{ key: LicenseKeyRow; app: AppRow; devices: DeviceRow[] } | undefined> {
  if (!isUuid(keyId)) return undefined;
  const [key] = await db.select().from(licenseKeys).where(eq(licenseKeys.id, keyId));
  if (!key) return undefined;
  const app = (await getApp(db, key.appId))!;
  const rows = await db.select().from(devices).where(eq(devices.keyId, key.id)).orderBy(desc(devices.lastSeen));
  return { key, app, devices: rows };
}
