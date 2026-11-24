// Cliente de licencias para Flutter (Android, iOS, escritorio y web).
// Solo usa paquetes de Dart puro: http, dart_jsonwebtoken y uuid. El almacenamiento
// se inyecta (ver secure_license_store.dart), así que esta clase se puede probar sin Flutter.
//
// Reglas que aplica (manual-configuracion.md, sección 7.2):
// - Verifica el token con la clave pública incrustada: firma ES256, iss, aud = appId y device_id.
// - 3 días de gracia sobre `exp` para cortes de red; si el token trae `lic_exp` y ya pasó, no vale (sin gracia).
// - Renueva cuando quedan menos de 2 días, salvo que el token ya llegue al vencimiento de la licencia.
// - Si el servidor rechaza la clave (403), borra lo guardado; si no hay red, sigue con el token válido.

import 'dart:async';
import 'dart:convert';

import 'package:dart_jsonwebtoken/dart_jsonwebtoken.dart';
import 'package:http/http.dart' as http;
import 'package:uuid/uuid.dart';

/// Dónde se guardan el id del dispositivo, la clave del usuario y el token.
abstract class LicenseStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

/// Almacén en memoria: solo para pruebas.
class MemoryLicenseStore implements LicenseStore {
  final Map<String, String> data = {};
  @override
  Future<String?> read(String key) async => data[key];
  @override
  Future<void> write(String key, String value) async => data[key] = value;
  @override
  Future<void> delete(String key) async => data.remove(key);
}

class LicenseConfig {
  /// URL de la API, sin barra final. Ej.: https://gestor-de-claves-api.onrender.com
  final String apiUrl;

  /// El app_id con el que registraste la app en el panel. Ej.: kordix-id
  final String appId;

  /// La clave de aplicación (gkapp_…) que dio el panel al registrar la app.
  final String appKey;

  /// Contenido de secrets/signing-public.pem. Nunca lo descargues del servidor.
  final String publicKeyPem;

  /// Debe coincidir con ISSUER de la API (por defecto "gestor-de-claves").
  final String issuer;

  /// Se guarda en el panel para saber desde dónde se activó. Ej.: android, ios, web.
  final String platform;

  final Duration grace;
  final Duration renewBefore;

  /// Render gratis puede tardar hasta un minuto en despertar.
  final Duration timeout;

  const LicenseConfig({
    required this.apiUrl,
    required this.appId,
    required this.appKey,
    required this.publicKeyPem,
    this.issuer = 'gestor-de-claves',
    this.platform = 'flutter',
    this.grace = const Duration(days: 3),
    this.renewBefore = const Duration(days: 2),
    this.timeout = const Duration(seconds: 60),
  });
}

/// Resultado de activar o comprobar la licencia.
class LicenseResult {
  /// true: la app puede seguir.
  final bool ok;

  /// Código para tu programa: invalid_key, key_revoked, key_expired, device_expired,
  /// device_limit_reached, invalid_client, rate_limited, network_error, invalid_token, no_license…
  final String? error;

  /// Motivo en español, para mostrárselo al usuario.
  final String message;

  /// Cuándo vence la licencia en este dispositivo (null = nunca o desconocido).
  final DateTime? licenseExpiresAt;

  const LicenseResult.valid({this.licenseExpiresAt})
      : ok = true,
        error = null,
        message = '';
  const LicenseResult.invalid(this.error, this.message)
      : ok = false,
        licenseExpiresAt = null;

  @override
  String toString() => ok ? 'LicenseResult(ok, vence: $licenseExpiresAt)' : 'LicenseResult($error: $message)';
}

class _TokenState {
  final Duration left; // negativo durante la gracia
  final bool reachesEnd; // el token ya llega al vencimiento de la licencia: renovar no lo alarga
  final DateTime? licenseExpiresAt;
  const _TokenState(this.left, this.reachesEnd, this.licenseExpiresAt);
}

class LicenseService {
  static const _deviceKey = 'gk_device_id';
  static const _licenseKey = 'gk_license';
  static const networkMessage = 'No se pudo conectar con el servidor de licencias. Revisa tu conexión.';

  final LicenseConfig config;
  final LicenseStore store;
  final http.Client _http;
  final DateTime Function() _now;
  late final ECPublicKey _publicKey = ECPublicKey(config.publicKeyPem);

  LicenseService(this.config, this.store, {http.Client? client, DateTime Function()? clock})
      : _http = client ?? http.Client(),
        _now = clock ?? DateTime.now;

  /// Id estable de esta instalación. Se crea una vez y se guarda.
  Future<String> deviceId() async {
    var id = await store.read(_deviceKey);
    if (id == null || id.isEmpty) {
      id = const Uuid().v4();
      await store.write(_deviceKey, id);
    }
    return id;
  }

  /// ¿Hay una clave guardada? (para decidir si mostrar la pantalla de activación).
  Future<bool> hasSavedLicense() async => (await store.read(_licenseKey)) != null;

  /// Comprueba al arrancar (y al volver a primer plano). Solo llama al servidor si hace falta.
  Future<LicenseResult> check({String? deviceName, String? appVersion, int? usageSeconds}) async {
    final saved = await _load();
    if (saved == null) return const LicenseResult.invalid('no_license', 'Introduce tu clave de licencia.');
    final state = await _tokenState(saved.token);
    if (state != null && (state.left > config.renewBefore || state.reachesEnd)) {
      return LicenseResult.valid(licenseExpiresAt: state.licenseExpiresAt);
    }
    final r = await activate(saved.licenseKey,
        deviceName: deviceName, appVersion: appVersion, usageSeconds: usageSeconds);
    // Sin red pero con un token todavía válido (dentro de la gracia): la app sigue.
    if (!r.ok && state != null && (r.error == 'network_error' || r.error == 'rate_limited' || r.error == 'server_error')) {
      return LicenseResult.valid(licenseExpiresAt: state.licenseExpiresAt);
    }
    return r;
  }

  /// Fuerza una consulta al servidor con la clave guardada (útil en pruebas o tras cambiar algo en el panel).
  Future<LicenseResult> refreshNow({String? deviceName, String? appVersion, int? usageSeconds}) async {
    final saved = await _load();
    if (saved == null) return const LicenseResult.invalid('no_license', 'Introduce tu clave de licencia.');
    return activate(saved.licenseKey, deviceName: deviceName, appVersion: appVersion, usageSeconds: usageSeconds);
  }

  /// Activa (o renueva) con la clave que escribió el usuario.
  /// usageSeconds: total de segundos de uso desde la instalación, si llevas la cuenta.
  Future<LicenseResult> activate(String licenseKey,
      {String? deviceName, String? appVersion, int? usageSeconds}) async {
    final http.Response res;
    try {
      res = await _http
          .post(
            Uri.parse('${config.apiUrl}/v1/verify'),
            headers: {'Content-Type': 'application/json', 'X-App-Key': config.appKey},
            body: jsonEncode({
              'app_id': config.appId,
              'license_key': licenseKey.trim(),
              'device_id': await deviceId(),
              'platform': config.platform,
              if (deviceName != null) 'device_name': deviceName,
              if (appVersion != null) 'app_version': appVersion,
              if (usageSeconds != null) 'usage_seconds': usageSeconds,
            }),
          )
          .timeout(config.timeout);
    } catch (_) {
      return const LicenseResult.invalid('network_error', networkMessage);
    }

    Map<String, dynamic> data;
    try {
      data = jsonDecode(res.body) as Map<String, dynamic>;
    } catch (_) {
      return const LicenseResult.invalid('server_error', 'Error del servidor. Inténtalo más tarde.');
    }

    if (data['ok'] != true) {
      final error = (data['error'] as String?) ?? 'server_error';
      final message = (data['message'] as String?) ?? 'No se pudo verificar la licencia.';
      // La clave ya no sirve: se borra para pedir otra. (invalid_client es culpa de la app, no del usuario.)
      if (res.statusCode == 403) await store.delete(_licenseKey);
      return LicenseResult.invalid(error, message);
    }

    final token = data['token'] as String?;
    final state = token == null ? null : await _tokenState(token);
    if (state == null) {
      return const LicenseResult.invalid(
          'invalid_token', 'La respuesta del servidor de licencias no es válida. Revisa la clave pública de la app.');
    }
    await store.write(_licenseKey, jsonEncode({'licenseKey': licenseKey.trim(), 'token': token}));
    return LicenseResult.valid(licenseExpiresAt: state.licenseExpiresAt);
  }

  /// Borra la clave y el token guardados (no el id del dispositivo).
  Future<void> forget() => store.delete(_licenseKey);

  Future<({String licenseKey, String token})?> _load() async {
    final raw = await store.read(_licenseKey);
    if (raw == null) return null;
    try {
      final m = jsonDecode(raw) as Map<String, dynamic>;
      return (licenseKey: m['licenseKey'] as String, token: m['token'] as String);
    } catch (_) {
      await store.delete(_licenseKey);
      return null;
    }
  }

  /// null si el token no vale.
  Future<_TokenState?> _tokenState(String token) async {
    try {
      // El algoritmo se fija aquí: dart_jsonwebtoken usaría el que diga la cabecera del token.
      final header = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(token.split('.').first))));
      if (header is! Map || header['alg'] != 'ES256') return null;

      final jwt = JWT.verify(token, _publicKey, checkExpiresIn: false, issuer: config.issuer);
      final p = jwt.payload as Map<String, dynamic>;
      final aud = p['aud'];
      if (aud != config.appId && !(aud is List && aud.contains(config.appId))) return null;
      if (p['device_id'] != await deviceId()) return null;

      final now = _now();
      final expSec = (p['exp'] as num).toInt();
      final licExpSec = (p['lic_exp'] as num?)?.toInt();
      final licExp = licExpSec == null ? null : DateTime.fromMillisecondsSinceEpoch(licExpSec * 1000);
      // Licencia vencida: sin gracia, aunque no haya red.
      if (licExp != null && !now.isBefore(licExp)) return null;
      final left = DateTime.fromMillisecondsSinceEpoch(expSec * 1000).difference(now);
      if (left + config.grace <= Duration.zero) return null;
      return _TokenState(left, licExpSec != null && expSec >= licExpSec, licExp);
    } catch (_) {
      return null;
    }
  }
}
