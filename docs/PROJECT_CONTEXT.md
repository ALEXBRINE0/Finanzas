# MiDinero 3.9

## Arquitectura y alcance

PWA estática para un usuario por navegador. `index.html` contiene interfaz, almacenamiento y libro de movimientos. `plan.js` contiene reglas complementarias de presupuesto. `sw.js` almacena los recursos estáticos para trabajo sin conexión. No hay backend, sincronización, conexión bancaria, telemetría ni nuevas dependencias de producción. No cambia el costo de alojamiento de la aplicación.

El dinero se expresa como enteros en centavos. El almacenamiento mantiene `midinero_personal_v1`, objeto `kv`, clave `estado`, esquema 1. Los nuevos campos de configuración tienen valores por defecto en `normalise`; los repartos históricos se mantienen sin recalcular. Respaldos JSON antiguos siguen admitidos. Las reservas nuevas se guardan en `movement.alloc` para que una edición futura de porcentajes no cambie el pasado.

## Decisiones del presupuesto

- La reserva de ofrenda es 10 % por ingreso nuevo libre, redondeado por operación. Se aplica desde `settings.offeringStart`, sin cargo retroactivo. No se aplica a préstamos, cobros de grupo, saldo inicial, reorganizaciones ni ahorro externo recuperado.
- Las entregas son gastos explícitos con categoría Ofrenda. La reserva pendiente se obtiene del historial de repartos y entregas, independientemente del último snapshot de reorganización. Evita perder la reserva al reorganizar o deshacer un registro anterior. Un excedente entregado se trata como adelanto, visible como apartado negativo.
- `capitalReturn` identifica entradas de ahorro externo previamente fuera del registro. Aumentan caja registrada, sin contarse como ingreso nuevo mensual. No representar de esta forma un traslado interno ya registrado.
- `planVersion: 1` identifica gastos nuevos que usan Necesidades. Los gastos antiguos de transporte mantienen el apartado original. Los nuevos gastos de Invitaciones usan Salidas. No se infiere la intención de notas antiguas.
- El indicador principal es el disponible prudente para salidas, con tope semanal. El saldo bancario se conserva como cifra secundaria y referencia de conciliación. Los importes dependen de la integridad de lo registrado y no sustituyen al banco.
- Se conserva el reparto porcentual existente. No se imponen porcentajes nuevos a usuarios que puedan tener compromisos desconocidos. Las necesidades semanales, el tope y la meta se pueden ajustar.
- La alternativa de servidor, conexión bancaria o API de IA añadiría costo, exposición de datos y mantenimiento sin ser necesaria para estas funciones.

## Invariantes y límites

La suma del reparto de un ingreso equivale exactamente a su importe. Una reserva no cambia caja. La entrega sí cambia caja y reserva una sola vez. Las transferencias internas conservan el dinero total. Antes de transferir emergencia se protegen los demás apartados positivos. La reorganización conserva el ahorro transferido y la ofrenda pendiente, y se rechaza si no hay saldo para ambos.

Las semanas son civiles de lunes a domingo en la zona local del dispositivo, igual que el resto de la aplicación. El domingo mostrado es un recordatorio al abrir la app; no hay tarea en segundo plano ni entrega automática. No se calcula rentabilidad de inversiones, tasas bancarias ni normas tributarias.

## Seguridad y privacidad

No incorporar respaldos, CSV reales, saldos, nombres de participantes ni capturas con datos reales al repositorio o a una PR. Los tests usan ejemplos sintéticos. No existen pagos automáticos ni transmisión de registros financieros a un servidor. Los textos exportados a CSV que comienzan con operadores de fórmula se neutralizan; los importes numéricos conservan el signo. Las nuevas variables de presupuesto y reservas se validan como centavos enteros no negativos.

Los datos locales y respaldos siguen sin cifrado. El ocultamiento visual del ahorro no es autenticación. No se ha realizado una auditoría integral de todos los importadores y rutas anteriores. No hay garantía de coordinación de escrituras entre varias pestañas simultáneas: usar una sola ventana para registrar. La pérdida de almacenamiento del navegador sigue requiriendo recuperación desde respaldo.

## Desarrollo y validación

No se requiere compilación. Servir el directorio por HTTP en localhost o HTTPS. Para desarrollo puede usarse `python -m http.server 8000 --bind 127.0.0.1`.

Pruebas de reglas, sin dependencias externas, con Node.js:

```sh
node --test tests/finance.test.cjs
```

Pruebas de navegador con Playwright disponible en el entorno:

```sh
node tests/browser.cjs
```

`PLAYWRIGHT_MODULE` admite la ruta del módulo en un runtime compartido. `CHROME_PATH` admite la ruta de un Chrome instalado. `TEST_ARTIFACTS` permite elegir el directorio de capturas sintéticas. No se instalan paquetes al ejecutar las pruebas. La prueba levanta un servidor restringido a los recursos de la app en 127.0.0.1 y lo cierra al terminar.

Cobertura de esta entrega: reparto en centavos y 20 000 importes, ingresos pequeños consecutivos, exclusiones de ofrenda, entrega parcial, arrastre semanal, corrección de ahorro recuperado y rollback por fallo de guardado, compatibilidad con apartados antiguos, reorganización y protección del ahorro, límites de salidas, validación negativa. En Chrome: formularios, persistencia tras recarga, exportación CSV, respaldo/restauración actual y antigua, 15 combinaciones de vista/ancho y registro persistente sin red.

## Publicación y recuperación

1. El usuario exporta un JSON privado **antes** de actualizar y conserva la dirección web y navegador existentes.
2. Revisar y aprobar los cambios antes de fusionarlos a la rama de publicación. No se requiere migración de servidor ni operación bancaria.
3. Publicar `index.html`, `plan.js`, `sw.js` e iconos/manifest existentes en el mismo origen y ruta. La caché cambia a `midinero-static-v3-9` e incluye `plan.js`.
4. Abrir con conexión, recargar y comprobar título 3.9, indicador de salidas y tarjetas nuevas. Revisar el saldo contra el banco antes de reorganizar los apartados.
5. Si hay una regresión, revertir el commit de código y publicar una versión de caché nueva. El formato extendido no debe abrirse con versiones antiguas para seguir registrando: estas no entienden las nuevas categorías. Restaurar el respaldo anterior a la actualización solo si se ha preservado aparte el registro posterior, para evitar perderlo. Preferir corregir el código manteniendo la versión de datos.

No cambiar la URL para probar con datos de producción: otro origen/ruta puede usar almacenamiento diferente. Una vista previa nueva no tiene automáticamente los datos del teléfono.
