import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const apps = pgTable("apps", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Identificador público que envían las apps como `app_id`. */
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  apiKeyHint: text("api_key_hint").notNull(),
  prevApiKeyHash: text("prev_api_key_hash"),
  prevApiKeyExpiresAt: ts("prev_api_key_expires_at"),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const licenseKeys = pgTable(
  "license_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id),
    keyHash: text("key_hash").notNull().unique(),
    keyHint: text("key_hint").notNull(),
    label: text("label").notNull(),
    maxDevices: integer("max_devices").notNull().default(1),
    expiresAt: ts("expires_at"),
    /** Si tiene valor, cada dispositivo vence N días después de activarse (licencias de prueba). */
    deviceValidityDays: integer("device_validity_days"),
    status: text("status", { enum: ["active", "revoked"] }).notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [
    check("max_devices_min", sql`${t.maxDevices} >= 1`),
    check("device_validity_days_min", sql`${t.deviceValidityDays} is null or ${t.deviceValidityDays} >= 1`),
    index("license_keys_app_idx").on(t.appId),
  ],
);

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    keyId: uuid("key_id")
      .notNull()
      .references(() => licenseKeys.id),
    deviceId: text("device_id").notNull(),
    name: text("name"),
    platform: text("platform"),
    appVersion: text("app_version"),
    firstIp: text("first_ip").notNull(),
    lastIp: text("last_ip").notNull(),
    firstSeen: ts("first_seen").notNull(),
    lastSeen: ts("last_seen").notNull(),
    expiresAt: ts("expires_at"),
    /** Último total de uso que informó la app (segundos desde la instalación). */
    usageSeconds: bigint("usage_seconds", { mode: "number" }),
    status: text("status", { enum: ["active", "removed"] }).notNull().default("active"),
  },
  (t) => [unique("devices_key_device_uq").on(t.keyId, t.deviceId)],
);

export const verificationLog = pgTable(
  "verification_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    keyId: uuid("key_id"),
    appSlug: text("app_slug").notNull(),
    deviceId: text("device_id").notNull(),
    ip: text("ip").notNull(),
    result: text("result").notNull(),
    usageSeconds: bigint("usage_seconds", { mode: "number" }),
    at: ts("at").notNull(),
  },
  (t) => [index("verification_log_ip_at_idx").on(t.ip, t.at), index("verification_log_at_idx").on(t.at)],
);

export type AppRow = typeof apps.$inferSelect;
export type LicenseKeyRow = typeof licenseKeys.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
