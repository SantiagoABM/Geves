import { and, count, eq, sql } from "drizzle-orm";
import { hashSecret, normalizeLicenseKey, safeEqualHex } from "./crypto.ts";
import type { Db } from "./db.ts";
import { apps, devices, licenseKeys, verificationLog, type AppRow } from "./schema.ts";

export type VerifyError =
  | "invalid_client"
  | "invalid_key"
  | "key_revoked"
  | "key_expired"
  | "device_expired"
  | "device_limit_reached";

export type VerifyInput = {
  appSlug: string;
  appKey: string;
  licenseKey: string;
  deviceId: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
  /** Total de segundos de uso desde la instalación, según la app. */
  usageSeconds?: number;
};

export type VerifyResult =
  | { ok: true; keyId: string; deviceId: string; newDevice: boolean; licenseExpiresAt: Date | null }
  | { ok: false; error: VerifyError; maxDevices?: number; expiresAt?: Date };

const DAY_MS = 86_400_000;

/** La fecha más próxima de las dos; `null` significa "nunca". */
function earliest(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function appKeyMatches(app: AppRow, appKey: string, now: Date): boolean {
  const h = hashSecret(appKey);
  if (safeEqualHex(app.apiKeyHash, h)) return true;
  return (
    !!app.prevApiKeyHash &&
    !!app.prevApiKeyExpiresAt &&
    app.prevApiKeyExpiresAt > now &&
    safeEqualHex(app.prevApiKeyHash, h)
  );
}

export async function verifyLicense(db: Db, i: VerifyInput, ctx: { ip: string; now: Date }): Promise<VerifyResult> {
  let keyId: string | null = null;
  const result = await (async (): Promise<VerifyResult> => {
    const [app] = await db.select().from(apps).where(eq(apps.slug, i.appSlug));
    if (!app || !app.active || !appKeyMatches(app, i.appKey, ctx.now)) return { ok: false, error: "invalid_client" };

    const normalized = normalizeLicenseKey(i.licenseKey);
    if (!normalized) return { ok: false, error: "invalid_key" };
    const [key] = await db.select().from(licenseKeys).where(eq(licenseKeys.keyHash, hashSecret(normalized)));
    if (!key || key.appId !== app.id) return { ok: false, error: "invalid_key" };
    keyId = key.id;
    if (key.status === "revoked") return { ok: false, error: "key_revoked" };
    if (key.expiresAt && key.expiresAt <= ctx.now) return { ok: false, error: "key_expired", expiresAt: key.expiresAt };

    // Solo se actualiza lo que la app envía: un campo ausente no borra el valor guardado.
    const details = {
      ...(i.deviceName !== undefined ? { name: i.deviceName } : {}),
      ...(i.platform !== undefined ? { platform: i.platform } : {}),
      ...(i.appVersion !== undefined ? { appVersion: i.appVersion } : {}),
      ...(i.usageSeconds !== undefined ? { usageSeconds: i.usageSeconds } : {}),
      lastIp: ctx.ip,
      lastSeen: ctx.now,
    };
    const expired = (d: { expiresAt: Date | null }) => !!d.expiresAt && d.expiresAt <= ctx.now;

    return db.transaction(async (tx) => {
      // Serializa los registros de una misma clave para que dos dispositivos simultáneos no superen el cupo.
      // Bloqueo consultivo: no requiere permiso UPDATE sobre license_keys (el rol de la API no lo tiene).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key.id}, 0))`);

      const [existing] = await tx
        .select()
        .from(devices)
        .where(and(eq(devices.keyId, key.id), eq(devices.deviceId, i.deviceId)));
      // Un dispositivo vencido no se reactiva ni ocupa cupo, esté activo o quitado.
      if (existing && expired(existing)) {
        return { ok: false, error: "device_expired", expiresAt: existing.expiresAt! } as const;
      }
      if (existing?.status === "active") {
        await tx.update(devices).set(details).where(eq(devices.id, existing.id));
        return {
          ok: true,
          keyId: key.id,
          deviceId: i.deviceId,
          newDevice: false,
          licenseExpiresAt: earliest(key.expiresAt, existing.expiresAt),
        } as const;
      }

      const [{ value: active } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(devices)
        .where(and(eq(devices.keyId, key.id), eq(devices.status, "active")));
      if (active >= key.maxDevices) return { ok: false, error: "device_limit_reached", maxDevices: key.maxDevices } as const;

      // Si vuelve un dispositivo quitado conserva su vencimiento: quitar y reactivar no reinicia la prueba.
      const deviceExpiresAt =
        existing?.expiresAt ??
        (key.deviceValidityDays ? new Date(ctx.now.getTime() + key.deviceValidityDays * DAY_MS) : null);
      const registration = {
        ...details,
        status: "active" as const,
        firstIp: ctx.ip,
        firstSeen: ctx.now,
        expiresAt: deviceExpiresAt,
      };
      if (existing) {
        await tx.update(devices).set(registration).where(eq(devices.id, existing.id));
      } else {
        await tx.insert(devices).values({ ...registration, keyId: key.id, deviceId: i.deviceId });
      }
      return {
        ok: true,
        keyId: key.id,
        deviceId: i.deviceId,
        newDevice: true,
        licenseExpiresAt: earliest(key.expiresAt, deviceExpiresAt),
      } as const;
    });
  })();

  await db.insert(verificationLog).values({
    keyId,
    appSlug: i.appSlug,
    deviceId: i.deviceId,
    ip: ctx.ip,
    result: result.ok ? "ok" : result.error,
    usageSeconds: i.usageSeconds ?? null,
    at: ctx.now,
  });
  return result;
}
