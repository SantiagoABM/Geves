// Prueba el cliente contra la API local: en la raíz del repo, npx tsx examples/test-api.ts <ruta.json> 3300
// y luego, en examples/flutter: $env:GK_TEST_CONFIG="<ruta.json>"; flutter test
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:gk_license_example/license/license_service.dart';
import 'package:http/http.dart' as http;

class CountingClient extends http.BaseClient {
  final http.Client inner = http.Client();
  int calls = 0;
  bool offline = false;
  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) {
    calls++;
    if (offline) throw const SocketException('sin red');
    return inner.send(request);
  }
}

void main() {
  final cfg = jsonDecode(File(Platform.environment['GK_TEST_CONFIG']!).readAsStringSync()) as Map<String, dynamic>;
  final keys = cfg['keys'] as Map<String, dynamic>;
  LicenseConfig config({String? appKey}) => LicenseConfig(
        apiUrl: cfg['apiUrl'],
        appId: cfg['appId'],
        appKey: appKey ?? cfg['appKey'],
        publicKeyPem: cfg['publicKeyPem'],
        platform: 'test',
        timeout: const Duration(seconds: 10),
      );

  test('caduca a los 90 s: lic_exp sin gracia y luego key_expired del servidor', () async {
    final s = LicenseService(config(), MemoryLicenseStore());
    final r = await s.activate(keys['shortExp']);
    expect(r.ok, isTrue, reason: '$r');
    expect(r.licenseExpiresAt, isNotNull);
    expect((await s.check()).ok, isTrue);
    final wait = r.licenseExpiresAt!.difference(DateTime.now()) + const Duration(seconds: 1);
    if (!wait.isNegative) await Future<void>.delayed(wait);
    final after = await s.check();
    expect(after.ok, isFalse);
    expect(after.error, 'key_expired');
    expect(after.message, 'Esta licencia venció.');
    expect(await s.hasSavedLicense(), isFalse);
  }, timeout: const Timeout(Duration(seconds: 150)));

  test('activa, guarda el token y después comprueba sin llamar al servidor', () async {
    final client = CountingClient();
    final s = LicenseService(config(), MemoryLicenseStore(), client: client);
    final r = await s.activate(' ${keys['normal']} ', deviceName: 'Pixel de prueba', appVersion: '1.0.0', usageSeconds: 120);
    expect(r.ok, isTrue, reason: '$r');
    expect(r.licenseExpiresAt, isNull);
    expect(client.calls, 1);
    expect((await s.check()).ok, isTrue);
    expect(client.calls, 1, reason: 'con un token nuevo no debe llamar al servidor');
  });

  test('otro dispositivo con la misma clave (máx. 1) → device_limit_reached', () async {
    final r = await LicenseService(config(), MemoryLicenseStore()).activate(keys['normal']);
    expect(r.error, 'device_limit_reached');
    expect(r.message, contains('máximo de dispositivos'));
  });

  test('clave inexistente → invalid_key y no guarda nada', () async {
    final s = LicenseService(config(), MemoryLicenseStore());
    final r = await s.activate('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE');
    expect(r.error, 'invalid_key');
    expect(await s.hasSavedLicense(), isFalse);
  });

  test('clave revocada → key_revoked', () async {
    final r = await LicenseService(config(), MemoryLicenseStore()).activate(keys['revoked']);
    expect(r.error, 'key_revoked');
    expect(r.message, 'Esta licencia fue anulada.');
  });

  test('clave de aplicación incorrecta → invalid_client', () async {
    final r = await LicenseService(config(appKey: 'gkapp_incorrecta'), MemoryLicenseStore()).activate(keys['free']);
    expect(r.error, 'invalid_client');
  });

  test('prueba de 3 días por dispositivo: devuelve cuándo vence', () async {
    final r = await LicenseService(config(), MemoryLicenseStore()).activate(keys['trial']);
    expect(r.ok, isTrue, reason: '$r');
    final days = r.licenseExpiresAt!.difference(DateTime.now()).inMinutes / (24 * 60);
    expect(days, closeTo(3, 0.01));
  });

  test('token manipulado: se descarta y se renueva con la clave guardada', () async {
    final client = CountingClient();
    final store = MemoryLicenseStore();
    final s = LicenseService(config(), store, client: client);
    expect((await s.activate(keys['free'])).ok, isTrue);
    final saved = jsonDecode((await store.read('gk_license'))!) as Map<String, dynamic>;
    final parts = (saved['token'] as String).split('.');
    final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map<String, dynamic>;
    payload['exp'] = (payload['exp'] as int) + 365 * 86400;
    parts[1] = base64Url.encode(utf8.encode(jsonEncode(payload))).replaceAll('=', '');
    saved['token'] = parts.join('.');
    await store.write('gk_license', jsonEncode(saved));
    expect((await s.check()).ok, isTrue);
    expect(client.calls, 2, reason: 'el token falso no vale: tuvo que pedir uno nuevo');
  });

  test('token con alg distinto de ES256 en la cabecera: se rechaza sin mirar la firma', () async {
    final client = CountingClient();
    final store = MemoryLicenseStore();
    final s = LicenseService(config(), store, client: client);
    expect((await s.activate(keys['free'])).ok, isTrue);
    final saved = jsonDecode((await store.read('gk_license'))!) as Map<String, dynamic>;
    final parts = (saved['token'] as String).split('.');
    parts[0] = base64Url.encode(utf8.encode(jsonEncode({'alg': 'HS256', 'typ': 'JWT'}))).replaceAll('=', '');
    saved['token'] = parts.join('.');
    await store.write('gk_license', jsonEncode(saved));
    client.offline = true;
    expect((await s.check()).ok, isFalse);
  });

  test('sin red: sigue con el token (gracia incluida) y bloquea al pasarla', () async {
    final client = CountingClient();
    final start = DateTime.now();
    var now = start;
    final s = LicenseService(config(), MemoryLicenseStore(), client: client, clock: () => now);
    expect((await s.activate(keys['free'])).ok, isTrue); // token de 7 días, sin lic_exp
    client.offline = true;
    now = start.add(const Duration(days: 6)); // queda 1 día: intenta renovar, no hay red, sigue
    expect((await s.check()).ok, isTrue);
    now = start.add(const Duration(days: 9)); // venció hace 2 días: dentro de la gracia de 3
    expect((await s.check()).ok, isTrue);
    now = start.add(const Duration(days: 10, hours: 12)); // pasó la gracia
    final r = await s.check();
    expect(r.ok, isFalse);
    expect(r.error, 'network_error');
    expect(await s.hasSavedLicense(), isTrue, reason: 'sin red no se borra: al volver la conexión renueva');
    client.offline = false;
    now = DateTime.now();
    expect((await s.check()).ok, isTrue);
  });

  test('licencia con vencimiento: sin red, vale hasta lic_exp y ni un segundo más', () async {
    final client = CountingClient();
    final start = DateTime.now();
    var now = start;
    final s = LicenseService(config(), MemoryLicenseStore(), client: client, clock: () => now);
    expect((await s.activate(keys['trial'])).ok, isTrue); // vence a los 3 días en este dispositivo
    client.offline = true;
    now = start.add(const Duration(days: 2, hours: 23)); // el token llega al fin: no renueva y vale
    expect((await s.check()).ok, isTrue);
    expect(client.calls, 1);
    now = start.add(const Duration(days: 3, minutes: 1)); // pasó: sin gracia aunque no haya red
    expect((await s.check()).ok, isFalse);
  });
}
