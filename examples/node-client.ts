/**
 * Cliente de referencia para apps Node (Express, NestJS, servidor de Next.js).
 * Autocontenido: solo depende de `jose` y de Node. Cópialo a tu app.
 *
 * Flujo:
 *  1. Si hay un token guardado y válido (con 3 días de gracia), la app sigue sin red.
 *     Si le quedan menos de 2 días, intenta renovarlo; si no hay red, sigue con el actual.
 *     Si la licencia vence (claim `lic_exp`), el token deja de valer ese instante, sin gracia y sin red.
 *  2. Si el token no vale, revalida con la clave guardada.
 *  3. Si no hay clave guardada o el servidor la rechaza, la pide al usuario.
 *  Los errores llevan `message`, el motivo en español para mostrárselo al usuario.
 */
import { importSPKI, jwtVerify } from "jose";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type CheckLicenseOptions = {
  apiUrl: string;
  appSlug: string;
  appKey: string;
  /** Clave pública de firma, incrustada en la app (nunca descargada del servidor). */
  publicKeyPem: string;
  issuer: string;
  storePath: string;
  deviceId: string;
  askLicenseKey: () => Promise<string>;
  deviceName?: string;
  appVersion?: string;
  /** Total de segundos de uso de la app desde su instalación (lo lleva tu app). */
  usageSeconds?: () => number;
};

export type CheckLicenseResult = { ok: true } | { ok: false; error: string; message: string };

const GRACE_SECONDS = 3 * 86_400;
const RENEW_BEFORE_SECONDS = 2 * 86_400;
const NETWORK_MESSAGE = "No se pudo conectar con el servidor de licencias. Revisa tu conexión.";

type Stored = { licenseKey: string; token: string };

function readStore(path: string): Stored | null {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return typeof s?.licenseKey === "string" && typeof s?.token === "string" ? s : null;
  } catch {
    return null;
  }
}

function writeStore(path: string, s: Stored) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(s), { mode: 0o600 });
}

type TokenState = {
  /** Segundos que le quedan al token (negativo si está en la gracia). */
  left: number;
  /** El token ya llega hasta el vencimiento de la licencia: renovarlo antes no lo alargaría. */
  reachesLicenseEnd: boolean;
};

/** Estado del token, o null si no es válido (firma, app, dispositivo, vencido o licencia vencida). */
async function tokenState(o: CheckLicenseOptions, token: string): Promise<TokenState | null> {
  try {
    const key = await importSPKI(o.publicKeyPem, "ES256");
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["ES256"],
      issuer: o.issuer,
      audience: o.appSlug,
      clockTolerance: GRACE_SECONDS,
      requiredClaims: ["exp", "device_id"],
    });
    if (payload.device_id !== o.deviceId) return null;
    const now = Math.floor(Date.now() / 1000);
    const licExp = typeof payload.lic_exp === "number" ? payload.lic_exp : null;
    if (licExp !== null && now >= licExp) return null; // licencia vencida: sin gracia
    return { left: payload.exp! - now, reachesLicenseEnd: licExp !== null && payload.exp! >= licExp };
  } catch {
    return null;
  }
}

type ServerAnswer =
  | { ok: true; token: string }
  | { ok: false; error: string; message: string; network?: boolean };

async function askServer(o: CheckLicenseOptions, licenseKey: string): Promise<ServerAnswer> {
  try {
    const res = await fetch(`${o.apiUrl}/v1/verify`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-key": o.appKey },
      body: JSON.stringify({
        app_id: o.appSlug,
        license_key: licenseKey,
        device_id: o.deviceId,
        platform: `node-${process.platform}`,
        ...(o.deviceName ? { device_name: o.deviceName } : {}),
        ...(o.appVersion ? { app_version: o.appVersion } : {}),
        ...(o.usageSeconds ? { usage_seconds: Math.max(0, Math.floor(o.usageSeconds())) } : {}),
      }),
      // 60 s: un servidor gratuito dormido (Render) tarda hasta un minuto en despertar.
      signal: AbortSignal.timeout(60_000),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string; message?: string };
    if (res.ok && data.ok && data.token) {
      // Nunca se guarda un token sin comprobar su firma.
      return (await tokenState(o, data.token)) !== null
        ? { ok: true, token: data.token }
        : { ok: false, error: "invalid_token", message: "La respuesta del servidor de licencias no es válida." };
    }
    // 429 y 5xx son temporales: se tratan como falta de red.
    if (res.status === 429 || res.status >= 500) {
      return { ok: false, error: data.error ?? "server_error", message: data.message ?? NETWORK_MESSAGE, network: true };
    }
    return { ok: false, error: data.error ?? "unknown_error", message: data.message ?? "No se pudo verificar la licencia." };
  } catch {
    return { ok: false, error: "network_error", message: NETWORK_MESSAGE, network: true };
  }
}

export async function checkLicense(o: CheckLicenseOptions): Promise<CheckLicenseResult> {
  const stored = readStore(o.storePath);

  if (stored) {
    const state = await tokenState(o, stored.token);
    if (state !== null) {
      if (state.left > RENEW_BEFORE_SECONDS || state.reachesLicenseEnd) return { ok: true };
      const r = await askServer(o, stored.licenseKey);
      if (r.ok) writeStore(o.storePath, { licenseKey: stored.licenseKey, token: r.token });
      else if (!r.network) {
        rmSync(o.storePath, { force: true });
        return { ok: false, error: r.error, message: r.message };
      }
      return { ok: true };
    }
    // Token inválido, vencido del todo o licencia vencida: revalidar con la clave guardada
    // (así se recoge una prórroga que hayas dado en el panel).
    const r = await askServer(o, stored.licenseKey);
    if (r.ok) {
      writeStore(o.storePath, { licenseKey: stored.licenseKey, token: r.token });
      return { ok: true };
    }
    if (r.network) return { ok: false, error: r.error, message: r.message };
    rmSync(o.storePath, { force: true });
  }

  const licenseKey = (await o.askLicenseKey()).trim();
  const r = await askServer(o, licenseKey);
  if (!r.ok) return { ok: false, error: r.error, message: r.message };
  writeStore(o.storePath, { licenseKey, token: r.token });
  return { ok: true };
}
