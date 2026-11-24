# Manual: conectar tus apps al gestor de claves

Guía paso a paso para que una app compruebe su licencia contra tu API: **Flutter (móvil)**, **web** (Angular, React…) y **backend** (Express, NestJS, Next.js). Al final hay una lista de pruebas con una clave real y una tabla de problemas frecuentes.

El código que vas a copiar está en la carpeta [`examples/`](../examples) y está probado contra la API:
- Flutter, en [`examples/flutter/lib/license/`](../examples/flutter/lib/license).
- Web, en [`examples/web/license.ts`](../examples/web/license.ts).
- Node, en [`examples/node-client.ts`](../examples/node-client.ts).

Las reglas de fondo (gracia, renovación, vencimientos) están en el [manual de configuración, sección 7](manual-configuracion.md#7-integrar-tus-aplicaciones).

## Índice

0. [Lo que necesitas](#0-lo-que-necesitas)
1. [Preparar la app en el panel](#1-preparar-la-app-en-el-panel)
2. [Prueba rápida sin app (PowerShell)](#2-prueba-rápida-sin-app-powershell)
3. [Flutter (Android e iOS)](#3-flutter-android-e-ios)
4. [Web (Angular, React, Vue…)](#4-web-angular-react-vue)
5. [Backend (Express, NestJS, Next.js)](#5-backend-express-nestjs-nextjs)
6. [Probar con la clave de un dispositivo](#6-probar-con-la-clave-de-un-dispositivo)
7. [Problemas frecuentes](#7-problemas-frecuentes)

---

## 0. Lo que necesitas

Cada app necesita **4 datos**. Los tres primeros van dentro de la app; la clave de usuario la escribe quien usa la app.

| Dato | Ejemplo | De dónde sale |
|---|---|---|
| URL de la API | `https://gestor-de-claves-api.onrender.com` | Tu servicio de Render |
| `app_id` | `kordix-id` | El identificador con el que registraste la app en el panel |
| Clave de aplicación | `gkapp_…` | La muestra el panel **una sola vez**, al registrar la app (o al renovarla) |
| Clave pública | `-----BEGIN PUBLIC KEY-----…` | El archivo `secrets\signing-public.pem` de tu PC |

Y para probar, una **clave de usuario** (`XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`), que creas en el panel.

> **Nunca** pongas en una app `secrets\signing-private.pem`, tu `.env` ni la `DATABASE_URL`. Solo la clave **pública**, que no es secreta: sirve para comprobar que las respuestas vienen de tu servidor.

## 1. Preparar la app en el panel

Arranca el panel (`npm run admin`) y abre `http://localhost:4000`.

### 1.1 La app

KORDIX ya está registrada. Para una app nueva: **＋ Registrar app**, con un `app_id` (minúsculas, números y guiones), el nombre y la URL.

- **App móvil o backend:** la URL solo es informativa. Pon la web de la app o la de tu empresa.
- **App web:** la URL tiene que ser **exactamente** el origen desde el que se abre la web, por ejemplo `https://kordix.com`. Mira la sección 4.1. La URL de KORDIX (`https://-/`) sirve para móvil, pero no para web.

Al registrar, el panel muestra la **clave de aplicación** una sola vez: cópiala (botón **Copiar**) y guárdala en tu gestor de contraseñas.

### 1.2 Si perdiste la clave de aplicación

En la página de la app pulsa **Renovar clave de app**, marca la casilla y confirma. El panel muestra una nueva. La anterior sigue funcionando 30 días, así que las apps ya publicadas no se cortan mientras las actualizas.

### 1.3 Crear una clave de usuario de prueba

En la página de la app pulsa **＋ Nueva clave**:

- **Etiqueta:** por ejemplo `Prueba móvil`.
- **Máximo de dispositivos:** `1`. Así podrás probar el límite (sección 6).
- **Vence el / Días de uso por dispositivo:** déjalos vacíos de momento. Los usarás en las pruebas de vencimiento.

Pulsa **Generar clave** y copia la clave: también se muestra una sola vez.

### 1.4 La clave pública

Abre `secrets\signing-public.pem` con el Bloc de notas y copia **todo**, incluidas las líneas `-----BEGIN PUBLIC KEY-----` y `-----END PUBLIC KEY-----`. Es la misma para todas tus apps.

## 2. Prueba rápida sin app (PowerShell)

Antes de tocar código, comprueba que la clave de aplicación y la de usuario funcionan. Cambia `gkapp_TU_CLAVE` y `TU-CLAVE-DE-USUARIO`:

```powershell
Invoke-RestMethod -Method Post -Uri "https://gestor-de-claves-api.onrender.com/v1/verify" -ContentType "application/json" -Headers @{ "X-App-Key" = "gkapp_TU_CLAVE" } -Body '{"app_id":"kordix-id","license_key":"TU-CLAVE-DE-USUARIO","device_id":"prueba-powershell-01"}'
```

- **Bien:** responde `ok : True` con un `token` y `expires_at`. En el panel, la clave ya tiene un dispositivo `prueba-powershell-01`.
- **Error:** PowerShell muestra el JSON con `error` y `message`. Busca el código en la [sección 7](#7-problemas-frecuentes).
- La primera petición puede tardar hasta un minuto si Render estaba dormido.

> **Importante:** esa prueba **ocupa una plaza** de la clave. Si la clave es de 1 dispositivo, entra en su página del panel y pulsa **Quitar** en `prueba-powershell-01` antes de probar en la app. Si no, la app recibirá «Esta licencia ya se usa en el máximo de dispositivos permitido».

## 3. Flutter (Android e iOS)

Probado con Flutter (Dart 3.13), `http` 1.6, `dart_jsonwebtoken` 3.4, `flutter_secure_storage` 11.2 y `uuid` 4.6.

### 3.1 Dependencias

En la carpeta de tu app:

```powershell
flutter pub add http dart_jsonwebtoken flutter_secure_storage uuid
```

### 3.2 Copiar los archivos

Copia la carpeta [`examples/flutter/lib/license/`](../examples/flutter/lib/license) a `lib/license/` de tu app. Son tres archivos:

| Archivo | Qué hace |
|---|---|
| `license_service.dart` | Habla con la API, verifica el token y decide si la app puede seguir. No depende de Flutter. |
| `secure_license_store.dart` | Guarda la clave y el token en el almacenamiento seguro del sistema (Keystore en Android, Keychain en iOS). |
| `license_gate.dart` | Pantalla de bloqueo: si la licencia vale, muestra tu app; si no, pide la clave. |

### 3.3 Configurar

En tu `lib/main.dart` (hay un ejemplo completo en [`examples/flutter/lib/main.dart`](../examples/flutter/lib/main.dart)):

```dart
import 'package:flutter/material.dart';

import 'license/license_gate.dart';
import 'license/license_service.dart';
import 'license/secure_license_store.dart';

const licenseConfig = LicenseConfig(
  apiUrl: 'https://gestor-de-claves-api.onrender.com',
  appId: 'kordix-id',
  appKey: String.fromEnvironment('GK_APP_KEY'), // se pasa al compilar (paso 3.5)
  publicKeyPem: '''-----BEGIN PUBLIC KEY-----
…pega aquí el contenido de signing-public.pem…
-----END PUBLIC KEY-----''',
  platform: 'android', // o 'ios': solo se usa para verlo en el panel
);

final licenseService = LicenseService(licenseConfig, const SecureLicenseStore());
```

La clave de aplicación se pasa al compilar con `--dart-define` para que no quede escrita en el código ni en Git. Igualmente va dentro del APK, así que no es un secreto fuerte (manual de configuración, sección 8).

### 3.4 Proteger la app

Envuelve tu pantalla principal con `LicenseGate`:

```dart
void main() {
  assert(licenseConfig.appKey.isNotEmpty, 'Falta --dart-define=GK_APP_KEY=gkapp_…');
  runApp(const MiApp());
}

class MiApp extends StatelessWidget {
  const MiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      home: LicenseGate(
        service: licenseService,
        appVersion: '1.0.0',       // opcional: se ve en el panel
        child: const PantallaPrincipal(), // tu app
      ),
    );
  }
}
```

Qué hace `LicenseGate`:
- **Al abrir la app:** comprueba la licencia. Solo llama al servidor la primera vez y cuando hay que renovar el token, cada 5 días aproximadamente.
- **Sin licencia:** muestra una pantalla con un campo para la clave y el motivo del rechazo en español.
- **Al volver a primer plano:** comprueba de nuevo. Sin red, sigue funcionando con el token guardado hasta 3 días después de que venza, salvo que la licencia tenga fecha de fin.

### 3.5 Android: permiso de internet y compilación

1. Abre `android/app/src/main/AndroidManifest.xml` y comprueba que, **antes** de `<application`, está esta línea (añádela si no está):

   ```xml
   <uses-permission android:name="android.permission.INTERNET" />
   ```

   En depuración funciona sin ella, pero **la versión publicada (release) no podrá conectarse** si falta.
2. Si al compilar Android sale un error de `minSdkVersion` por `flutter_secure_storage`, sube `minSdk` en `android/app/build.gradle` (o `build.gradle.kts`) al valor que indique el error.
3. Ejecutar en el móvil o emulador:

   ```powershell
   flutter run --dart-define=GK_APP_KEY=gkapp_TU_CLAVE
   ```

4. Compilar para publicar:

   ```powershell
   flutter build apk --release --dart-define=GK_APP_KEY=gkapp_TU_CLAVE
   ```

En **iOS** no hace falta nada más (la API es HTTPS).

### 3.6 Opcional

- **Nombre del dispositivo en el panel:** pasa `deviceName:` a `activate`/`check` (por ejemplo, con el paquete `device_info_plus`).
- **Horas de uso:** pasa `usageSeconds:` con el **total** de segundos de uso desde la instalación. Lo calcula tu app (por ejemplo, sumando el tiempo en primer plano y guardándolo). Si lo recoges, menciónalo en tu política de privacidad.
- **Botón «Comprobar ahora» para pruebas:** la app solo consulta al servidor cuando le toca renovar. Para ver al momento un cambio del panel (revocar, vencer), añade en modo depuración:

  ```dart
  import 'package:flutter/foundation.dart';
  // …dentro de tu pantalla:
  if (kDebugMode)
    TextButton(
      onPressed: () async {
        final r = await licenseService.refreshNow();
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(r.ok ? 'Licencia válida' : r.message)),
        );
      },
      child: const Text('Comprobar licencia ahora'),
    ),
  ```

  Si el servidor rechaza la clave, se borra lo guardado: al salir y volver a la app aparece la pantalla de activación.

### 3.7 Volver a probar el cliente (opcional)

Si cambias `license_service.dart`, puedes repetir sus pruebas contra una API local con base en memoria. Nunca tocan tu API publicada.

1. En la raíz del repositorio, arranca la API de prueba (escribe sus claves en un JSON):

   ```powershell
   npx tsx examples/test-api.ts "$env:TEMP\gk-api-prueba.json" 3300
   ```

2. En otra terminal:

   ```powershell
   cd examples\flutter; $env:GK_TEST_CONFIG = "$env:TEMP\gk-api-prueba.json"; flutter test
   ```

   Tarda algo más de un minuto, porque una prueba espera a que venza una clave de 90 segundos. Si repites, reinicia antes la API de prueba.

`flutter analyze` falla en rutas con «ñ» (como `Pequeños Proyectos`) por un fallo del propio analizador. Si lo necesitas, copia la carpeta a una ruta sin acentos.

## 4. Web (Angular, React, Vue…)

> **Aviso:** todo lo que corre en el navegador lo puede leer y modificar el usuario. Esta comprobación disuade, pero **los datos de verdad tienen que protegerse en tu backend** (sección 5).

### 4.1 La URL registrada tiene que ser el origen exacto

El navegador solo deja llamar a la API desde un origen (esquema + dominio + puerto) que coincida con la URL de alguna app **activa** del panel:

| Web abierta en | URL que debe estar registrada |
|---|---|
| `https://kordix.com` | `https://kordix.com` |
| `https://app.kordix.com` | `https://app.kordix.com` (otro subdominio es otro origen) |
| `http://localhost:4200` (desarrollo) | `http://localhost:4200` |

El panel todavía no permite editar la URL de una app. Hay dos casos:
- **Para desarrollar en tu PC:** registra una app aparte, por ejemplo `dev-local` con la URL `http://localhost:4200`, y desactívala cuando termines. Basta con que exista y esté activa para que ese origen quede permitido. Tu web sigue usando el `app_id` y la clave de aplicación de su app real.
- **Para la web publicada de KORDIX:** como su URL es `https://-/`, registra una app con el dominio real (por ejemplo `kordix-web` con `https://kordix.com`) y usa su `app_id` y su clave de aplicación.

Si el origen no coincide, verás en la consola del navegador un error de **CORS** y la app recibirá `network_error`.

### 4.2 Instalar y copiar

```powershell
npm install jose
```

Copia [`examples/web/license.ts`](../examples/web/license.ts) a tu proyecto, por ejemplo como `src/app/license/license-client.ts`.

### 4.3 Configurar (común)

```ts
// src/app/license/license.ts
import { LicenseClient } from "./license-client";

export const license = new LicenseClient({
  apiUrl: "https://gestor-de-claves-api.onrender.com",
  appId: "kordix-web",
  appKey: "gkapp_…", // en web siempre se ve en el código del navegador
  publicKeyPem: `-----BEGIN PUBLIC KEY-----
…contenido de signing-public.pem…
-----END PUBLIC KEY-----`,
});
```

La clase guarda el id del navegador, la clave y el token en `localStorage`. Borrar los datos del sitio cuenta como **dispositivo nuevo**.

### 4.4 Angular

> El cliente (`license-client.ts`) está probado; este cableado de Angular no se ha compilado en este repositorio.

**Guard** de rutas (`src/app/license/license.guard.ts`):

```ts
import { inject } from "@angular/core";
import { CanActivateFn, Router } from "@angular/router";
import { license } from "./license";

export const licenseGuard: CanActivateFn = async () => {
  const router = inject(Router); // inject() antes de cualquier await
  const r = await license.check();
  if (r.ok) return true;
  return router.createUrlTree(["/activar"], { queryParams: r.error === "no_license" ? {} : { motivo: r.message } });
};
```

**Pantalla de activación** (`src/app/license/activar.component.ts`):

```ts
import { Component, inject, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute, Router } from "@angular/router";
import { license } from "./license";

@Component({
  selector: "app-activar",
  standalone: true,
  imports: [FormsModule],
  template: `
    <h1>Activar licencia</h1>
    <form (ngSubmit)="activar()">
      <input name="clave" [(ngModel)]="clave" placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" />
      <button type="submit" [disabled]="enviando()">{{ enviando() ? "Conectando…" : "Activar" }}</button>
    </form>
    @if (mensaje()) { <p class="error">{{ mensaje() }}</p> }
  `,
})
export class ActivarComponent {
  private router = inject(Router);
  clave = "";
  enviando = signal(false);
  mensaje = signal(inject(ActivatedRoute).snapshot.queryParamMap.get("motivo") ?? "");

  async activar() {
    this.enviando.set(true);
    const r = await license.activate(this.clave);
    this.enviando.set(false);
    if (r.ok) await this.router.navigateByUrl("/");
    else this.mensaje.set(r.message);
  }
}
```

**Rutas** (`app.routes.ts`): la pantalla de activación queda fuera del guard y todo lo demás dentro.

```ts
export const routes: Routes = [
  { path: "activar", component: ActivarComponent },
  { path: "", canActivate: [licenseGuard], children: [/* tus rutas */] },
];
```

### 4.5 React (u otro framework)

La idea es la misma: llamar a `license.check()` al arrancar y mostrar tu app o la pantalla de activación.

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { license } from "./license";

export function LicenseGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"checking" | "ok" | "ask">("checking");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");

  useEffect(() => {
    license.check().then((r) => {
      setState(r.ok ? "ok" : "ask");
      if (!r.ok && r.error !== "no_license") setMessage(r.message);
    });
  }, []);

  if (state === "ok") return <>{children}</>;
  if (state === "checking") return <p>Comprobando licencia…</p>;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await license.activate(key);
        if (r.ok) setState("ok");
        else setMessage(r.message);
      }}
    >
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="Clave de licencia" />
      <button type="submit">Activar</button>
      {message && <p>{message}</p>}
    </form>
  );
}
```

## 5. Backend (Express, NestJS, Next.js)

En un backend, el «dispositivo» es **la instalación del servidor**: la licencia se comprueba al arrancar y cada 12 horas, y si no vale, el servidor responde 403. Sirve para vender o controlar instalaciones de tu backend (por ejemplo, el servidor de un cliente).

> **No uses el backend como intermediario de muchos usuarios** (que el navegador le mande la clave y el backend llame a `/v1/verify` por cada uno). La API limita **por IP**: 30 peticiones por minuto y 10 fallos cada 15 minutos. Con todos los usuarios saliendo desde la IP de tu servidor, se bloquearía enseguida. Para licencias por usuario, cada app (móvil o web) llama directamente a la API.

### 5.1 Instalar y configurar

```powershell
npm install jose
```

Copia [`examples/node-client.ts`](../examples/node-client.ts) a tu proyecto. Configúralo con variables de entorno (en el `.env` del servidor, nunca en Git):

```env
GK_APP_KEY=gkapp_…
LICENSE_KEY=XXXXX-XXXXX-XXXXX-XXXXX-XXXXX
```

```ts
// src/license.ts
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkLicense } from "./node-client";

const DATA_DIR = "./data"; // carpeta persistente; no la borres al actualizar
mkdirSync(DATA_DIR, { recursive: true });
const DEVICE_FILE = `${DATA_DIR}/device-id`;
if (!existsSync(DEVICE_FILE)) writeFileSync(DEVICE_FILE, randomUUID());

export const licenseOptions = {
  apiUrl: "https://gestor-de-claves-api.onrender.com",
  appSlug: "mi-backend",                  // su app_id en el panel
  appKey: process.env.GK_APP_KEY!,
  publicKeyPem: readFileSync("./signing-public.pem", "utf8"),
  issuer: "gestor-de-claves",
  storePath: `${DATA_DIR}/license.json`,
  deviceId: readFileSync(DEVICE_FILE, "utf8").trim(),
  deviceName: "Servidor de producción",
  askLicenseKey: async () => process.env.LICENSE_KEY ?? "",
};

let licensed = false;
export const isLicensed = () => licensed;

export async function refreshLicense() {
  const r = await checkLicense(licenseOptions);
  licensed = r.ok;
  if (!r.ok) console.error(`Licencia no válida (${r.error}): ${r.message}`);
}
```

Copia también `signing-public.pem` junto al código (la **pública**).

### 5.2 Express

```ts
import { isLicensed, refreshLicense } from "./license";

await refreshLicense();
setInterval(refreshLicense, 12 * 60 * 60 * 1000).unref();

app.use((req, res, next) => (isLicensed() ? next() : res.status(403).json({ error: "licencia_no_valida" })));
```

### 5.3 NestJS

```ts
import { CanActivate, ForbiddenException, Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { isLicensed, refreshLicense } from "./license";

@Injectable()
export class LicenseService implements OnApplicationBootstrap {
  async onApplicationBootstrap() {
    await refreshLicense();
    setInterval(refreshLicense, 12 * 60 * 60 * 1000).unref();
  }
}

@Injectable()
export class LicenseGuard implements CanActivate {
  canActivate() {
    if (!isLicensed()) throw new ForbiddenException("Licencia no válida");
    return true;
  }
}

// app.module.ts → providers: [LicenseService, { provide: APP_GUARD, useClass: LicenseGuard }]
```

### 5.4 Next.js

Comprueba en el servidor, nunca solo en el navegador. En tus Route Handlers o en el layout raíz:

```ts
// lib/license-check.ts
import { refreshLicense, isLicensed } from "../src/license";

let lastCheck = 0;
export async function licensed(): Promise<boolean> {
  if (Date.now() - lastCheck > 12 * 60 * 60 * 1000) {
    lastCheck = Date.now();
    await refreshLicense();
  }
  return isLicensed();
}

// app/api/algo/route.ts
export async function GET() {
  if (!(await licensed())) return Response.json({ error: "licencia_no_valida" }, { status: 403 });
  // …
}
```

En plataformas sin disco persistente (Vercel y similares) pon `storePath` y el id del dispositivo en `/tmp`. Cada instancia nueva contará como dispositivo, así que dale a esa clave un máximo de dispositivos holgado.

### 5.5 .NET

Hay un ejemplo completo (no probado en este repositorio) en el [manual de configuración, sección 7.6](manual-configuracion.md#76-net).

## 6. Probar con la clave de un dispositivo

Usa la clave de prueba de la sección 1.3 (máximo 1 dispositivo). Ten el panel abierto en la página de esa clave: cada prueba se ve ahí y en **Registro de verificaciones**.

> **Límite de intentos:** más de **10 fallos en 15 minutos** desde la misma IP bloquean las verificaciones de esa IP durante un rato (error «Demasiados intentos…»). Si haces muchas pruebas de error seguidas, espera 15 minutos.

| # | Prueba | Cómo | Qué debe pasar | En el panel |
|---|---|---|---|---|
| 1 | Activación | Abre la app y escribe la clave. | Entra en la app. | La clave muestra 1 / 1 dispositivos, con su plataforma y su versión. |
| 2 | Clave con otro formato | Escríbela en minúsculas o sin guiones. | Se acepta igual. | — |
| 3 | Sin red | Activa el modo avión y vuelve a abrir la app. | Entra igual: usa el token guardado. | Sin cambios. |
| 4 | Clave inexistente | En otro dispositivo, o tras borrar los datos de la app, escribe una clave inventada. | «La clave de licencia no es válida.» | Registro: `invalid_key`. |
| 5 | Límite de dispositivos | Activa la misma clave en un segundo dispositivo o emulador. | «Esta licencia ya se usa en el máximo de dispositivos permitido.» | Registro: `device_limit_reached`. |
| 6 | Liberar una plaza | En el panel, **Quitar** el primer dispositivo. Reintenta en el segundo. | El segundo entra. | El primero aparece como «Quitado». |
| 7 | Prueba con días | Crea otra clave con **Días de uso por dispositivo: 1** y actívala. | Entra. Al día siguiente, al abrir, pide la clave: «El periodo de uso de esta licencia en este dispositivo terminó.» | El dispositivo muestra su fecha de fin. |
| 8 | Vencimiento de la clave | En la clave, **Ajustes → Vence el:** ayer. En la app, pulsa «Comprobar licencia ahora» (3.6). | «Esta licencia venció.» y, al volver a abrir, pide la clave. | Etiqueta «Vencida». |
| 9 | Revocar | En el panel, **Zona de peligro → Revocar clave**. En la app, «Comprobar licencia ahora». | «Esta licencia fue anulada.» | Etiqueta «Revocada». |
| 10 | App desactivada | En la página de la app, **Desactivar app**. Comprobar ahora. | «Esta aplicación no está autorizada para verificar licencias.» La clave **no** se borra: al reactivar la app vuelve a funcionar. | Registro: `invalid_client`. |

Sobre los tiempos:
- **Los vencimientos son exactos**, aunque no haya red, porque la fecha de fin viaja dentro del token.
- **Revocar o desactivar la app no es instantáneo** en un dispositivo que ya tiene token: se nota cuando renueva (como mucho 7 días, más 3 de gracia sin red). Para las pruebas, usa «Comprobar licencia ahora».
- **En Android, desinstalar la app borra su id de dispositivo:** al reinstalar cuenta como dispositivo nuevo. Si te quedas sin plazas, quita el antiguo en el panel. En iOS el id suele sobrevivir a la reinstalación.

## 7. Problemas frecuentes

| Lo que ves | Causa probable | Qué hacer |
|---|---|---|
| «Esta aplicación no está autorizada para verificar licencias.» (`invalid_client`) | Clave de aplicación incorrecta, `app_id` que no es el de esa clave, o app desactivada. | Revisa los dos datos; si perdiste la clave, renuévala (1.2). |
| «La clave de licencia no es válida.» (`invalid_key`) | La clave no existe o es de otra app. | Revisa que la clave sea de esta app en el panel. |
| «Esta licencia ya se usa en el máximo de dispositivos permitido.» | La clave ya tiene todas sus plazas ocupadas (¿la prueba de PowerShell?). | Quita el dispositivo sobrante en el panel o sube el máximo. |
| «La respuesta del servidor de licencias no es válida…» (`invalid_token`) | La clave pública de la app no es la del servidor, está incompleta, o el `issuer` no coincide. | Vuelve a copiar `signing-public.pem` entero, con sus líneas BEGIN/END. |
| «No se pudo conectar con el servidor de licencias…» en el móvil | Sin internet, permiso `INTERNET` ausente en Android release, o URL mal escrita. | Revisa 3.5 y la URL (sin barra final). |
| Lo mismo, en web, con un error de CORS en la consola | El origen de la web no coincide con la URL de ninguna app activa. | Sección 4.1. |
| La primera activación tarda casi un minuto | Render gratis estaba dormido. | Normal; o configura cron-job.org (manual de configuración, 12.8). |
| «Demasiados intentos. Espera un minuto…» (`rate_limited`) | Más de 30 peticiones por minuto o 10 fallos en 15 minutos desde tu IP. | Espera; la app sigue funcionando si ya tenía token. |
| «La petición no es válida.» (`bad_request`) | Falta un campo o el `device_id` no tiene formato válido (8 a 128 caracteres: letras, números, `. _ : -`). | Error de programación: revisa la llamada. |
