import { getConnInfo } from "@hono/node-server/conninfo";
import {
  isAllowedOrigin,
  isRateLimited,
  pingDatabase,
  verifyLicense,
  type Db,
  type TokenSigner,
  type VerifyError,
} from "@gk/core";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";

/** Texto opcional: se recorta si es largo y se ignora si no es texto. Nunca hace fallar la verificación. */
const optionalText = (max: number) =>
  z
    .unknown()
    .transform((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined))
    .optional();

const VerifyBody = z.object({
  app_id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  license_key: z.string().min(1).max(64),
  device_id: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/),
  device_name: optionalText(100),
  platform: optionalText(50),
  app_version: optionalText(30),
  // Total de segundos de uso desde la instalación; un valor inválido se ignora.
  usage_seconds: z
    .unknown()
    .transform((v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1e11 ? (v as number) : undefined))
    .optional(),
});

const STATUS: Record<VerifyError, 401 | 403> = {
  invalid_client: 401,
  invalid_key: 403,
  key_revoked: 403,
  key_expired: 403,
  device_expired: 403,
  device_limit_reached: 403,
};

type ApiError = VerifyError | "rate_limited" | "bad_request" | "payload_too_large" | "not_found" | "server_error";

/** Motivo legible para que la app se lo muestre al usuario. La fecha va aparte en `expires_at`. */
const MESSAGES: Record<ApiError, string> = {
  invalid_client: "Esta aplicación no está autorizada para verificar licencias.",
  invalid_key: "La clave de licencia no es válida.",
  key_revoked: "Esta licencia fue anulada.",
  key_expired: "Esta licencia venció.",
  device_expired: "El periodo de uso de esta licencia en este dispositivo terminó.",
  device_limit_reached: "Esta licencia ya se usa en el máximo de dispositivos permitido.",
  rate_limited: "Demasiados intentos. Espera un minuto y vuelve a intentarlo.",
  bad_request: "La petición no es válida.",
  payload_too_large: "La petición es demasiado grande.",
  not_found: "Ruta no encontrada.",
  server_error: "Error del servidor. Inténtalo más tarde.",
};

const fail = (error: ApiError, extra: Record<string, unknown> = {}) => ({
  ok: false,
  error,
  ...extra,
  message: MESSAGES[error],
});

const WAKEUP_DB_EVERY_MS = 60_000;

export type ApiDeps = { db: Db; signer: TokenSigner; ipHeader?: string; now?: () => Date };

export function createApiApp(d: ApiDeps) {
  const now = d.now ?? (() => new Date());
  const app = new Hono();

  const clientIp = (c: Context): string => {
    let ip: string | undefined;
    if (d.ipHeader) ip = c.req.header(d.ipHeader)?.split(",")[0]?.trim();
    else {
      try {
        ip = getConnInfo(c).remote.address;
      } catch {
        ip = undefined;
      }
    }
    return (ip || "unknown").slice(0, 64);
  };

  app.use(secureHeaders());

  // CORS solo para los orígenes de las apps registradas y activas (apps web como Angular).
  app.use("/v1/*", async (c, next) => {
    const origin = c.req.header("origin");
    const allowed = origin ? await isAllowedOrigin(d.db, origin) : false;
    const setCors = (h: Headers) => {
      if (!allowed || !origin) return;
      h.set("Access-Control-Allow-Origin", origin);
      h.set("Access-Control-Allow-Methods", "POST");
      h.set("Access-Control-Allow-Headers", "Content-Type, X-App-Key");
      h.set("Access-Control-Max-Age", "600");
      h.append("Vary", "Origin");
    };
    if (c.req.method === "OPTIONS") {
      const res = c.body(null, 204);
      setCors(res.headers);
      return res;
    }
    await next();
    setCors(c.res.headers);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  // Para un cron externo (cron-job.org): mantiene despierta la API en Render y, como mucho una vez
  // por minuto, consulta la base para que Supabase no pause el proyecto. Las llamadas de ese minuto
  // reciben el último resultado, así que nadie puede cargar la base llamando a esta ruta.
  let dbCheck: { at: number; ok: Promise<boolean> } | undefined;
  app.get("/wakeup", async (c) => {
    const t = now().getTime();
    if (!dbCheck || t - dbCheck.at >= WAKEUP_DB_EVERY_MS) dbCheck = { at: t, ok: pingDatabase(d.db) };
    return (await dbCheck.ok) ? c.json({ ok: true }) : c.json(fail("server_error"), 503);
  });

  app.post(
    "/v1/verify",
    bodyLimit({ maxSize: 4096, onError: (c) => c.json(fail("payload_too_large"), 413) }),
    async (c) => {
      const ip = clientIp(c);
      const at = now();
      if (await isRateLimited(d.db, ip, at)) {
        c.header("Retry-After", "60");
        return c.json(fail("rate_limited"), 429);
      }

      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        return c.json(fail("bad_request"), 400);
      }
      const parsed = VerifyBody.safeParse(raw);
      if (!parsed.success) return c.json(fail("bad_request"), 400);
      const b = parsed.data;

      const result = await verifyLicense(
        d.db,
        {
          appSlug: b.app_id,
          appKey: c.req.header("x-app-key") ?? "",
          licenseKey: b.license_key,
          deviceId: b.device_id,
          ...(b.device_name !== undefined ? { deviceName: b.device_name } : {}),
          ...(b.platform !== undefined ? { platform: b.platform } : {}),
          ...(b.app_version !== undefined ? { appVersion: b.app_version } : {}),
          ...(b.usage_seconds !== undefined ? { usageSeconds: b.usage_seconds } : {}),
        },
        { ip, now: at },
      );

      if (!result.ok) {
        const body = fail(result.error, {
          ...(result.maxDevices !== undefined ? { max_devices: result.maxDevices } : {}),
          ...(result.expiresAt ? { expires_at: result.expiresAt.toISOString() } : {}),
        });
        if (result.maxDevices !== undefined) {
          body.message = `${MESSAGES.device_limit_reached.slice(0, -1)} (${result.maxDevices}).`;
        }
        return c.json(body, STATUS[result.error]);
      }

      const { token, expiresAt } = await d.signer.sign(
        {
          appSlug: b.app_id,
          keyId: result.keyId,
          deviceId: result.deviceId,
          licenseExpiresAt: result.licenseExpiresAt,
        },
        at,
      );
      return c.json({
        ok: true,
        token,
        expires_at: expiresAt.toISOString(),
        license_expires_at: result.licenseExpiresAt?.toISOString() ?? null,
      });
    },
  );

  app.notFound((c) => c.json(fail("not_found"), 404));
  app.onError((err, c) => {
    console.error("[api] error no controlado:", err);
    return c.json(fail("server_error"), 500);
  });

  return app;
}
