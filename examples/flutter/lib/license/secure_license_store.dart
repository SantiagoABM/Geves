// Almacenamiento seguro del sistema: Keystore en Android, Keychain en iOS/macOS,
// DPAPI en Windows. En web usa el almacenamiento del navegador (no es secreto).

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'license_service.dart';

class SecureLicenseStore implements LicenseStore {
  final FlutterSecureStorage _storage;

  const SecureLicenseStore([this._storage = const FlutterSecureStorage()]);

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}
