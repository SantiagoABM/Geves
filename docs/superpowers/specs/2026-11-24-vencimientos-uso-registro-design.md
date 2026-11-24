# Vencimientos, horas de uso y limpieza del registro — diseño corto

Aprobado punto por punto en la conversación del 2026-11-24. Amplía `2026-11-23-gestor-de-claves-design.md`.

## Por qué

- Dar **licencias de prueba**: que una clave o un dispositivo deje de funcionar en una fecha, y que la app
  diga el motivo. Sin fecha, la licencia funciona para siempre.
- Saber **cuánto se usa** cada app por dispositivo.
- **Limpiar el registro de verificaciones** (Supabase gratis tiene ~500 MB) guardando antes una copia en CSV.

## Ya existía (no cambia)

ID de dispositivo, primera y última IP, fecha de registro (`first_seen`) y de último uso (`last_seen`),
nombre, plataforma y versión de la app, vencimiento fijo de la clave (`key_expired`), fecha de creación de
clave y de app.

## Qué se añade

1. **Vencimiento por dispositivo (opción A, opcional).** Al crear la clave: "válida N días desde la
   activación" (vacío = sin límite). Cada dispositivo nuevo recibe `expires_at = activación + N días`.
   En el panel se puede cambiar o quitar la fecha de cada dispositivo. Manda la fecha que llegue antes
   (clave o dispositivo). Dispositivo vencido → `device_expired`.
2. **El token nunca dura más que la licencia.** `exp = min(ahora + TTL, vencimiento)` y, si hay
   vencimiento, claim `lic_exp` que el cliente comprueba **sin gracia**, también sin red.
   La respuesta 200 incluye `license_expires_at` (ISO o `null`).
3. **Motivo legible.** Toda respuesta de error lleva `message` en español; `key_expired` y
   `device_expired` llevan además `expires_at`.
4. **Editar vencimientos** en el panel: fecha fija de la clave (quitar o cambiar) y días por dispositivo
   (afecta a los dispositivos que se activen después).
5. **Horas de uso.** Campo opcional `usage_seconds`: total acumulado desde la instalación. Se guarda el
   último valor en el dispositivo y en cada fila del registro.
6. **Campos opcionales tolerantes.** Textos demasiado largos se recortan, valores con tipo incorrecto se
   ignoran; nunca hacen fallar la verificación. Un campo que no se envía no borra el valor guardado.
7. **Registro en el panel.** Página `/log`: eliges un día, descargas el CSV de todo lo anterior (ese día
   incluido) y, después, lo borras con casilla de confirmación.
8. **Fecha de registro de la app** visible en el panel.

## Decisiones mías (corregibles)

- Si un dispositivo quitado vuelve a activarse y ya tenía vencimiento, lo conserva (quitar y volver a
  activar no reinicia la prueba).
- El día elegido para el registro debe ser anterior a hoy: protege las filas que usa el límite de
  intentos. Fechas en la hora local del PC.
- CSV separado por `;` con BOM UTF-8, para que Excel en español lo abra en columnas con tildes. Las
  celdas que empiezan por `= + - @` se escapan (evita inyección de fórmulas con datos que manda el
  dispositivo).
- Cliente de referencia: si el token ya llega al vencimiento de la licencia, no renueva en cada arranque;
  renueva cuando vence (así recoge una prórroga que hayas dado).
