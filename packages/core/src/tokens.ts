import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose";

const ALG = "ES256";

export async function generateSigningKeys(): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
  const { privateKey, publicKey } = await generateKeyPair(ALG, { extractable: true });
  return { privateKeyPem: await exportPKCS8(privateKey), publicKeyPem: await exportSPKI(publicKey) };
}

export type TokenClaims = {
  appSlug: string;
  keyId: string;
  deviceId: string;
  /** Vencimiento de la licencia (clave o dispositivo, el más próximo). `null` = nunca. */
  licenseExpiresAt?: Date | null;
};

export interface TokenSigner {
  sign(c: TokenClaims, now: Date): Promise<{ token: string; expiresAt: Date }>;
}

export async function createTokenSigner(o: {
  privateKeyPem: string;
  kid: string;
  issuer: string;
  ttlSeconds: number;
}): Promise<TokenSigner> {
  const key = await importPKCS8(o.privateKeyPem, ALG);
  return {
    async sign(c, now) {
      const iat = Math.floor(now.getTime() / 1000);
      // El token nunca dura más que la licencia; `lic_exp` permite cortar ese día exacto, sin gracia y sin red.
      const licExp = c.licenseExpiresAt ? Math.floor(c.licenseExpiresAt.getTime() / 1000) : null;
      const exp = licExp === null ? iat + o.ttlSeconds : Math.min(iat + o.ttlSeconds, licExp);
      const token = await new SignJWT({ device_id: c.deviceId, ...(licExp === null ? {} : { lic_exp: licExp }) })
        .setProtectedHeader({ alg: ALG, kid: o.kid, typ: "JWT" })
        .setIssuer(o.issuer)
        .setAudience(c.appSlug)
        .setSubject(c.keyId)
        .setIssuedAt(iat)
        .setExpirationTime(exp)
        .sign(key);
      return { token, expiresAt: new Date(exp * 1000) };
    },
  };
}

/**
 * Lógica de referencia que replican los clientes: firma, emisor, app,
 * vencimiento del token (con gracia), vencimiento de la licencia (sin gracia)
 * y que el token sea de este dispositivo.
 */
export async function verifyLicenseToken(
  token: string,
  publicKeyPem: string,
  o: { issuer: string; appSlug: string; deviceId: string; graceSeconds: number; now?: Date },
): Promise<{ keyId: string; deviceId: string; expiresAt: Date; licenseExpiresAt: Date | null }> {
  const key = await importSPKI(publicKeyPem, ALG);
  const { payload } = await jwtVerify(token, key, {
    algorithms: [ALG],
    issuer: o.issuer,
    audience: o.appSlug,
    clockTolerance: o.graceSeconds,
    ...(o.now ? { currentDate: o.now } : {}),
    requiredClaims: ["sub", "exp", "device_id"],
  });
  if (payload.device_id !== o.deviceId) throw new Error("El token pertenece a otro dispositivo.");
  const licExp = typeof payload.lic_exp === "number" ? payload.lic_exp : null;
  const nowSec = Math.floor((o.now ?? new Date()).getTime() / 1000);
  if (licExp !== null && nowSec >= licExp) throw new Error("La licencia venció.");
  return {
    keyId: payload.sub!,
    deviceId: o.deviceId,
    expiresAt: new Date(payload.exp! * 1000),
    licenseExpiresAt: licExp === null ? null : new Date(licExp * 1000),
  };
}
