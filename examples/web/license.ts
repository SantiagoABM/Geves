/**
 * Cliente de licencias para apps que corren en el navegador (Angular, React, Vue, Next.js en cliente…).
 * Solo depende de `jose` (npm install jose). El almacenamiento se inyecta; por defecto, localStorage.
 *
 * Aviso: todo lo que corre en el navegador lo puede leer y modificar el usuario. Esta comprobación
 * disuade, pero la protección real de los datos tiene que estar en tu backend.
 *
 * Reglas (manual-configuracion.md, 7.2): firma ES256 con la clave pública incrustada, iss, aud = appId
 * y device_id; 3 días de gracia sobre exp; si el token trae lic_exp y ya pasó, no vale; renovar cuando
 * quedan menos de 2 días salvo que el token ya llegue al fin de la licencia; borrar lo guardado si el
 * servidor rechaza la clave (403), pero no si solo falla la red.
 */
import { importSPKI, jwtVerify } from "jose";

/** Lo mínimo de `Storage` que se usa: localStorage lo cumple. */
export type LicenseStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type LicenseConfig = {
  /** URL de la API, sin barra final. */
  apiUrl: string;
  /** app_id registrado en el panel. */
  appId: string;
  /** Clave de aplicación (gkapp_…). */
  appKey: string;
  /** Contenido de signing-public.pem. Nunca lo descargues del servidor. */
  publicKeyPem: string;
  /** ISSUER de la API (por defecto "gestor-de-claves"). */
  issuer?: string;
  /** Se ve en el panel. Por defecto "web". */
  platform?: string;
  /** Por defecto 60 s: Render gratis tarda en despertar. */
  timeoutMs?: number;
};

export type LicenseResult =
  | { ok: true; licenseExpiresAt: Date | null }
  | { ok: false; error: string; message: string };

type Saved = { licenseKey: string; token: string };
type TokenState = { left: number; reachesEnd: boolean; licenseExpiresAt: Date | null };

const GRACE_SECONDS = 3 * 86_400;
const RENEW_BEFORE_SECONDS = 2 * 86_400;
const DEVICE_KEY = "gk_device_id";
const LICENSE_KEY = "gk_license";
const TEMPORARY = new Set(["network_error", "rate_limited", "server_error"]);
export const NETWORK_MESSAGE = "No se pudo conectar con el servidor de licencias. Revisa tu conexión.";

export class LicenseClient {
  private readonly storage: LicenseStorage;
  private readonly now: () => number;
  private publicKey?: Awaited<ReturnType<typeof importSPKI>>;

  constructor(
    private readonly config: LicenseConfig,
    opts: { storage?: LicenseStorage; now?: () => number; fetch?: typeof fetch } = {},
  ) {
    this.storage = opts.storage ?? globalThis.localStorage;
    this.now = opts.now ?? Date.now;
    if (opts.fetch) this.fetchImpl = opts.fetch;
  }

  private fetchImpl: typeof fetch = (...args) => fetch(...args);

  /** Id estable de este navegador. Borrar los datos del sitio lo cambia (cuenta como dispositivo nuevo). */
  deviceId(): string {
    let id = this.storage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      this.storage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  hasSavedLicense(): boolean {
    return this.load() !== null;
  }

  /** Llamar al arrancar (o en un guard de rutas). Solo llama al servidor si hace falta. */
  async check(extra: { appVersion?: string; usageSeconds?: number } = {}): Promise<LicenseResult> {
    const saved = this.load();
    if (!saved) return { ok: false, error: "no_license", message: "Introduce tu clave de licencia." };
    const state = await this.tokenState(saved.token);
    if (state && (state.left > RENEW_BEFORE_SECONDS || state.reachesEnd)) {
      return { ok: true, licenseExpiresAt: state.licenseExpiresAt };
    }
    const r = await this.activate(saved.licenseKey, extra);
    if (!r.ok && state && TEMPORARY.has(r.error)) return { ok: true, licenseExpiresAt: state.licenseExpiresAt };
    return r;
  }

  /** Consulta al servidor con la clave guardada aunque el token siga vigente (pruebas, cambios en el panel). */
  async refreshNow(extra: { appVersion?: string; usageSeconds?: number } = {}): Promise<LicenseResult> {
    const saved = this.load();
    if (!saved) return { ok: false, error: "no_license", message: "Introduce tu clave de licencia." };
    return this.activate(saved.licenseKey, extra);
  }

  /** Activa (o renueva) con la clave que escribió el usuario. */
  async activate(licenseKey: string, extra: { appVersion?: string; usageSeconds?: number } = {}): Promise<LicenseResult> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.apiUrl}/v1/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-App-Key": this.config.appKey },
        body: JSON.stringify({
          app_id: this.config.appId,
          license_key: licenseKey.trim(),
          device_id: this.deviceId(),
          platform: this.config.platform ?? "web",
          ...(extra.appVersion ? { app_version: extra.appVersion } : {}),
          ...(extra.usageSeconds !== undefined ? { usage_seconds: Math.max(0, Math.floor(extra.usageSeconds)) } : {}),
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 60_000),
      });
    } catch {
      return { ok: false, error: "network_error", message: NETWORK_MESSAGE };
    }

    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      token?: string;
      error?: string;
      message?: string;
    };
    if (!data.ok) {
      // La clave ya no sirve: se borra para pedir otra. (401 invalid_client es un problema de la app, no del usuario.)
      if (res.status === 403) this.storage.removeItem(LICENSE_KEY);
      return {
        ok: false,
        error: data.error ?? "server_error",
        message: data.message ?? "Error del servidor. Inténtalo más tarde.",
      };
    }

    const state = data.token ? await this.tokenState(data.token) : null;
    if (!state) {
      return {
        ok: false,
        error: "invalid_token",
        message: "La respuesta del servidor de licencias no es válida. Revisa la clave pública de la app.",
      };
    }
    this.storage.setItem(LICENSE_KEY, JSON.stringify({ licenseKey: licenseKey.trim(), token: data.token }));
    return { ok: true, licenseExpiresAt: state.licenseExpiresAt };
  }

  /** Borra la clave y el token guardados (no el id del dispositivo). */
  forget(): void {
    this.storage.removeItem(LICENSE_KEY);
  }

  private load(): Saved | null {
    const raw = this.storage.getItem(LICENSE_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw) as Saved;
      return typeof s.licenseKey === "string" && typeof s.token === "string" ? s : null;
    } catch {
      return null;
    }
  }

  private async tokenState(token: string): Promise<TokenState | null> {
    try {
      this.publicKey ??= await importSPKI(this.config.publicKeyPem, "ES256");
      const nowSec = Math.floor(this.now() / 1000);
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ["ES256"],
        issuer: this.config.issuer ?? "gestor-de-claves",
        audience: this.config.appId,
        clockTolerance: GRACE_SECONDS,
        currentDate: new Date(nowSec * 1000),
        requiredClaims: ["exp", "device_id"],
      });
      if (payload.device_id !== this.deviceId()) return null;
      const licExp = typeof payload.lic_exp === "number" ? payload.lic_exp : null;
      if (licExp !== null && nowSec >= licExp) return null; // licencia vencida: sin gracia
      return {
        left: payload.exp! - nowSec,
        reachesEnd: licExp !== null && payload.exp! >= licExp,
        licenseExpiresAt: licExp === null ? null : new Date(licExp * 1000),
      };
    } catch {
      return null;
    }
  }
}
