// Ejemplo de main.dart: tu app solo se muestra si la licencia es válida.
// Ejecuta con:  flutter run --dart-define=GK_APP_KEY=gkapp_…
// (así la clave de aplicación no queda escrita en el código ni en Git).

import 'package:flutter/material.dart';

import 'license/license_gate.dart';
import 'license/license_service.dart';
import 'license/secure_license_store.dart';

const licenseConfig = LicenseConfig(
  apiUrl: 'https://gestor-de-claves-api.onrender.com',
  appId: 'kordix-id',
  appKey: String.fromEnvironment('GK_APP_KEY'),
  // Pega aquí el contenido completo de secrets/signing-public.pem.
  publicKeyPem: '''-----BEGIN PUBLIC KEY-----
PEGA_AQUI_TU_CLAVE_PUBLICA
-----END PUBLIC KEY-----''',
  platform: 'android', // o 'ios', 'web'…: solo se usa para verlo en el panel
);

final licenseService = LicenseService(licenseConfig, const SecureLicenseStore());

void main() {
  assert(licenseConfig.appKey.isNotEmpty, 'Falta --dart-define=GK_APP_KEY=gkapp_…');
  runApp(const MiApp());
}

class MiApp extends StatelessWidget {
  const MiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mi app',
      home: LicenseGate(
        service: licenseService,
        appVersion: '1.0.0',
        child: const PantallaPrincipal(),
      ),
    );
  }
}

class PantallaPrincipal extends StatelessWidget {
  const PantallaPrincipal({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mi app')),
      body: const Center(child: Text('Licencia válida: aquí va tu app.')),
    );
  }
}
