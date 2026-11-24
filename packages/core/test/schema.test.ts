import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { applyApiRoleGrants, apps, devices, licenseKeys, sslFor } from "../src/index.ts";
import { createTestDb } from "../src/testing.ts";

/** Drizzle envuelve el error de PostgreSQL; el mensaje original está en `cause`. */
async function expectDenied(p: PromiseLike<unknown>) {
  const err = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e as { cause?: { message?: string } },
  );
  expect(err?.cause?.message).toMatch(/permission denied/);
}

async function seed() {
  const t = await createTestDb();
  const [app] = await t.db
    .insert(apps)
    .values({ slug: "demo", name: "Demo", url: "https://demo.test", apiKeyHash: "h", apiKeyHint: "hint" })
    .returning();
  const [key] = await t.db
    .insert(licenseKeys)
    .values({ appId: app!.id, keyHash: "kh", keyHint: "1234", label: "Cliente" })
    .returning();
  return { ...t, app: app!, key: key! };
}

describe("sslFor", () => {
  it("exige TLS con verificación de certificado para bases remotas", () => {
    expect(sslFor("postgres://u:p@ep-x.eu-central-1.aws.neon.tech/db")).toBe("verify-full");
  });

  it("no usa TLS en conexiones locales (túnel SSH)", () => {
    expect(sslFor("postgres://u:p@127.0.0.1:5433/db")).toBe(false);
    expect(sslFor("postgres://u:p@localhost/db")).toBe(false);
  });

  it("respeta un sslmode explícito en la URL", () => {
    expect(sslFor("postgres://u:p@db.example.com/db?sslmode=disable")).toBeUndefined();
  });
});

describe("esquema", () => {
  it("max_devices vale 1 por defecto", async () => {
    const { key } = await seed();
    expect(key.maxDevices).toBe(1);
  });

  it("no permite el mismo dispositivo dos veces en una clave", async () => {
    const { db, key } = await seed();
    const row = {
      keyId: key.id,
      deviceId: "device-0001",
      firstIp: "1.1.1.1",
      lastIp: "1.1.1.1",
      firstSeen: new Date(),
      lastSeen: new Date(),
    };
    await db.insert(devices).values(row);
    await expect(db.insert(devices).values(row)).rejects.toThrow();
  });
});

describe("applyApiRoleGrants", () => {
  it("rechaza contraseñas cortas o con caracteres raros", async () => {
    const { db } = await seed();
    await expect(applyApiRoleGrants(db, "x")).rejects.toThrow();
    await expect(applyApiRoleGrants(db, "a".repeat(30) + "';--")).rejects.toThrow();
  });

  it("el rol gk_api lee claves pero no puede crearlas ni tocar apps", async () => {
    const { db, pg, key } = await seed();
    await applyApiRoleGrants(db, "a".repeat(32));
    await pg.exec("SET ROLE gk_api");
    try {
      const rows = await db.select().from(licenseKeys);
      expect(rows).toHaveLength(1);
      await expectDenied(db.insert(licenseKeys).values({ appId: key.appId, keyHash: "x2", keyHint: "x", label: "x" }));
      await expectDenied(db.update(apps).set({ name: "hack" }));
      await expectDenied(db.update(licenseKeys).set({ maxDevices: 99 }));
      await db.insert(devices).values({
        keyId: key.id,
        deviceId: "device-0002",
        firstIp: "1.1.1.1",
        lastIp: "1.1.1.1",
        firstSeen: new Date(),
        lastSeen: new Date(),
      });
    } finally {
      await pg.exec("RESET ROLE");
    }
  });

  it("se puede aplicar dos veces (cambia la contraseña)", async () => {
    const { db } = await seed();
    await applyApiRoleGrants(db, "a".repeat(32));
    await applyApiRoleGrants(db, "b".repeat(32));
    const r = (await db.execute(sql`select 1 from pg_roles where rolname = 'gk_api'`)) as { rows?: unknown[] };
    expect(r.rows ?? r).toHaveLength(1);
  });
});
