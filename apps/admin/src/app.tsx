import {
  AdminInputError,
  createApp,
  createLicenseKey,
  deleteVerificationLog,
  exportVerificationLogCsv,
  getApp,
  getLicenseKeyDetail,
  listApps,
  listLicenseKeys,
  logCutoff,
  logSummary,
  removeDevice,
  revokeLicenseKey,
  rotateAppKey,
  setAppActive,
  setDeviceExpiry,
  setKeyExpiration,
  setMaxDevices,
  type Db,
} from "@gk/core";
import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import {
  AppKeyShownPage,
  AppPage,
  HomePage,
  LicenseKeyPage,
  LicenseKeyShownPage,
  LogPage,
  MessagePage,
  SCRIPT,
  STYLE,
} from "./views.tsx";

export type AdminDeps = { db: Db; port: number; now?: () => Date };

const field = (body: Record<string, unknown>, name: string): string => {
  const v = body[name];
  return typeof v === "string" ? v : "";
};

/** Un día del formulario (AAAA-MM-DD) vence al final de ese día, hora local. Vacío = nunca. */
const endOfDay = (s: string): Date | null => (s.trim() ? new Date(`${s.trim()}T23:59:59`) : null);
/** Número opcional: vacío = sin valor. */
const optionalInt = (s: string): number | null => (s.trim() ? Number(s) : null);

export function createAdminApp(d: AdminDeps) {
  const { db } = d;
  const now = d.now ?? (() => new Date());
  const allowedHosts = new Set([`127.0.0.1:${d.port}`, `localhost:${d.port}`]);
  const allowedOrigins = [...allowedHosts].map((h) => `http://${h}`);
  const app = new Hono();

  // Solo responde si se le habla como localhost: bloquea DNS rebinding y accesos desde la red.
  app.use(async (c, next) => {
    if (!allowedHosts.has(new URL(c.req.url).host)) return c.text("Forbidden", 403);
    await next();
  });
  app.use(csrf({ origin: allowedOrigins }));
  app.use(
    secureHeaders({
      contentSecurityPolicy: { defaultSrc: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] },
      referrerPolicy: "no-referrer",
    }),
  );
  app.use(async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  app.get("/style.css", (c) => c.body(STYLE, 200, { "Content-Type": "text/css; charset=utf-8" }));
  app.get("/app.js", (c) => c.body(SCRIPT, 200, { "Content-Type": "text/javascript; charset=utf-8" }));

  /** Apps para la barra lateral (y el inicio). */
  const nav = () => listApps(db);

  app.get("/", async (c) => c.html(<HomePage apps={await nav()} register={c.req.query("registrar") !== undefined} />));

  app.post("/apps", async (c) => {
    const b = await c.req.parseBody();
    try {
      const { app: created, appKey } = await createApp(db, {
        slug: field(b, "slug"),
        name: field(b, "name"),
        url: field(b, "url"),
      });
      return c.html(<AppKeyShownPage apps={await nav()} app={created} appKey={appKey} rotated={false} />);
    } catch (e) {
      if (e instanceof AdminInputError) return c.html(<HomePage apps={await nav()} error={e.message} />, 400);
      throw e;
    }
  });

  app.get("/apps/:id", async (c) => {
    const a = await getApp(db, c.req.param("id"));
    if (!a) return c.notFound();
    return c.html(<AppPage apps={await nav()} app={a} keys={await listLicenseKeys(db, a.id)} />);
  });

  app.post("/apps/:id/keys", async (c) => {
    const a = await getApp(db, c.req.param("id"));
    if (!a) return c.notFound();
    const b = await c.req.parseBody();
    try {
      const { key, licenseKey } = await createLicenseKey(db, {
        appId: a.id,
        label: field(b, "label"),
        maxDevices: Number(field(b, "max_devices") || "1"),
        expiresAt: endOfDay(field(b, "expires_at")),
        deviceValidityDays: optionalInt(field(b, "device_validity_days")),
      });
      return c.html(<LicenseKeyShownPage apps={await nav()} app={a} row={key} licenseKey={licenseKey} />);
    } catch (e) {
      if (e instanceof AdminInputError) {
        return c.html(<AppPage apps={await nav()} app={a} keys={await listLicenseKeys(db, a.id)} error={e.message} open="key" />, 400);
      }
      throw e;
    }
  });

  app.post("/apps/:id/rotate", async (c) => {
    const a = await getApp(db, c.req.param("id"));
    if (!a) return c.notFound();
    if (field(await c.req.parseBody(), "confirm") !== "yes") {
      return c.html(
        <AppPage apps={await nav()} app={a} keys={await listLicenseKeys(db, a.id)} error="Marca la casilla para confirmar." open="rotate" />,
        400,
      );
    }
    const appKey = await rotateAppKey(db, a.id, now());
    return c.html(<AppKeyShownPage apps={await nav()} app={(await getApp(db, a.id))!} appKey={appKey} rotated={true} />);
  });

  app.post("/apps/:id/active", async (c) => {
    const a = await getApp(db, c.req.param("id"));
    if (!a) return c.notFound();
    await setAppActive(db, a.id, field(await c.req.parseBody(), "active") === "1");
    return c.redirect(`/apps/${a.id}`, 303);
  });

  app.get("/keys/:id", async (c) => {
    const detail = await getLicenseKeyDetail(db, c.req.param("id"));
    if (!detail) return c.notFound();
    return c.html(<LicenseKeyPage apps={await nav()} app={detail.app} row={detail.key} devices={detail.devices} />);
  });

  app.post("/keys/:id/revoke", async (c) => {
    const detail = await getLicenseKeyDetail(db, c.req.param("id"));
    if (!detail) return c.notFound();
    if (field(await c.req.parseBody(), "confirm") !== "yes") {
      return c.html(
        <LicenseKeyPage apps={await nav()} app={detail.app} row={detail.key} devices={detail.devices} error="Marca la casilla para confirmar." />,
        400,
      );
    }
    await revokeLicenseKey(db, detail.key.id, now());
    return c.redirect(`/keys/${detail.key.id}`, 303);
  });

  app.post("/keys/:id/max-devices", async (c) => {
    const detail = await getLicenseKeyDetail(db, c.req.param("id"));
    if (!detail) return c.notFound();
    try {
      await setMaxDevices(db, detail.key.id, Number(field(await c.req.parseBody(), "max_devices")));
    } catch (e) {
      if (e instanceof AdminInputError) {
        return c.html(<LicenseKeyPage apps={await nav()} app={detail.app} row={detail.key} devices={detail.devices} error={e.message} open="settings" />, 400);
      }
      throw e;
    }
    return c.redirect(`/keys/${detail.key.id}`, 303);
  });

  app.post("/keys/:id/expiration", async (c) => {
    const detail = await getLicenseKeyDetail(db, c.req.param("id"));
    if (!detail) return c.notFound();
    const b = await c.req.parseBody();
    try {
      await setKeyExpiration(db, detail.key.id, {
        expiresAt: endOfDay(field(b, "expires_at")),
        deviceValidityDays: optionalInt(field(b, "device_validity_days")),
      });
    } catch (e) {
      if (e instanceof AdminInputError) {
        return c.html(<LicenseKeyPage apps={await nav()} app={detail.app} row={detail.key} devices={detail.devices} error={e.message} open="settings" />, 400);
      }
      throw e;
    }
    return c.redirect(`/keys/${detail.key.id}`, 303);
  });

  app.post("/devices/:id/expiry", async (c) => {
    let keyId: string | undefined;
    try {
      keyId = await setDeviceExpiry(db, c.req.param("id"), endOfDay(field(await c.req.parseBody(), "expires_at")));
    } catch (e) {
      if (!(e instanceof AdminInputError)) throw e;
      return c.html(<MessagePage apps={await nav()} title="Fecha no válida" message={e.message} />, 400);
    }
    if (!keyId) return c.notFound();
    return c.redirect(`/keys/${keyId}`, 303);
  });

  app.get("/log", async (c) => c.html(<LogPage apps={await nav()} summary={await logSummary(db)} />));

  app.get("/log/export", async (c) => {
    const until = (c.req.query("until") ?? "").trim(); // validado por logCutoff antes de ir en la cabecera
    let cutoff: Date;
    try {
      cutoff = logCutoff(until, now());
    } catch (e) {
      if (e instanceof AdminInputError) return c.html(<LogPage apps={await nav()} summary={await logSummary(db)} error={e.message} />, 400);
      throw e;
    }
    const { csv } = await exportVerificationLogCsv(db, cutoff);
    return c.body(csv, 200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="verificaciones-hasta-${until}.csv"`,
    });
  });

  app.post("/log/delete", async (c) => {
    const b = await c.req.parseBody();
    try {
      const cutoff = logCutoff(field(b, "until"), now());
      if (field(b, "confirm") !== "yes") throw new AdminInputError("Marca la casilla para confirmar.");
      const deleted = await deleteVerificationLog(db, cutoff);
      return c.html(<LogPage apps={await nav()} summary={await logSummary(db)} deleted={deleted} />);
    } catch (e) {
      if (e instanceof AdminInputError) return c.html(<LogPage apps={await nav()} summary={await logSummary(db)} error={e.message} />, 400);
      throw e;
    }
  });

  app.post("/devices/:id/remove", async (c) => {
    let keyId: string | undefined;
    try {
      keyId = await removeDevice(db, c.req.param("id"));
    } catch (e) {
      if (!(e instanceof AdminInputError)) throw e;
    }
    if (!keyId) return c.notFound();
    return c.redirect(`/keys/${keyId}`, 303);
  });

  app.notFound(async (c) =>
    c.html(<MessagePage apps={await nav().catch(() => [])} title="No encontrado" message="Esa página no existe." />, 404),
  );
  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse(); // p. ej. el 403 del CSRF
    console.error("[admin] error:", err);
    return c.html(<MessagePage title="Error" message="Algo falló. Revisa la consola del panel." />, 500);
  });

  return app;
}
