# Gestor de claves

Servidor de licencias para tus aplicaciones (Flutter, .NET, Express, NestJS, Next.js y Angular). Cada app pide una clave al usuario y la valida contra este servicio, que registra los dispositivos (ID e IP) y limita cuántos puede usar cada clave.

- `apps/api`: API pública (`POST /v1/verify`). Es lo único que se publica.
- `apps/admin`: panel de administración. Solo local, en `127.0.0.1`.
- `packages/core`: base de datos, criptografía y reglas.
- `examples/node-client.ts`: cliente de referencia probado para apps Node.

**Configuración, despliegue e integración:** [docs/manual-configuracion.md](docs/manual-configuracion.md)

```powershell
npm install
```

```powershell
npm test
```
