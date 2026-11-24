// Pantalla de bloqueo: si la licencia vale, muestra tu app (child); si no, pide la clave.
// Vuelve a comprobar cada vez que la app vuelve a primer plano (sin red usa el token guardado).

import 'package:flutter/material.dart';

import 'license_service.dart';

class LicenseGate extends StatefulWidget {
  final LicenseService service;
  final Widget child;

  /// Opcional: versión de tu app, se ve en el panel.
  final String? appVersion;

  const LicenseGate({super.key, required this.service, required this.child, this.appVersion});

  @override
  State<LicenseGate> createState() => _LicenseGateState();
}

class _LicenseGateState extends State<LicenseGate> with WidgetsBindingObserver {
  bool _checking = true;
  bool _licensed = false;
  bool _sending = false;
  String _message = '';
  final _keyController = TextEditingController();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _check();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _keyController.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _check();
  }

  Future<void> _check() async {
    final r = await widget.service.check(appVersion: widget.appVersion);
    if (!mounted) return;
    setState(() {
      _checking = false;
      _licensed = r.ok;
      // «no_license» es el primer arranque: no hace falta mostrar un error.
      _message = r.ok || r.error == 'no_license' ? '' : r.message;
    });
  }

  Future<void> _activate() async {
    final key = _keyController.text.trim();
    if (key.isEmpty) return;
    setState(() {
      _sending = true;
      _message = '';
    });
    final r = await widget.service.activate(key, appVersion: widget.appVersion);
    if (!mounted) return;
    setState(() {
      _sending = false;
      _licensed = r.ok;
      _message = r.ok ? '' : r.message;
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_licensed) return widget.child;
    if (_checking) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    return Scaffold(
      appBar: AppBar(title: const Text('Activar licencia')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text('Escribe la clave de licencia que te dieron.'),
              const SizedBox(height: 16),
              TextField(
                controller: _keyController,
                enabled: !_sending,
                textCapitalization: TextCapitalization.characters,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Clave de licencia',
                  hintText: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX',
                  border: OutlineInputBorder(),
                ),
                onSubmitted: (_) => _activate(),
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _sending ? null : _activate,
                child: Text(_sending ? 'Conectando… (puede tardar hasta un minuto)' : 'Activar'),
              ),
              if (_message.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(_message, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
