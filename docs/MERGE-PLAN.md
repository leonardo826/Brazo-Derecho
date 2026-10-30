# Plan para juntar el stack en main

Los pull requests van uno encima del otro. No se mergea este directo a `main`: hay que entrar por abajo.

| Orden | PR | Rama | Base | Qué entra |
| --- | --- | --- | --- | --- |
| 1 | [#1](https://github.com/leonardo826/Brazo-Derecho/pull/1) | `cursor/brazo-derecho-beta-4ea2` | `main` | Beta multi-empresa |
| 2 | [#2](https://github.com/leonardo826/Brazo-Derecho/pull/2) | `cursor/canales-cobro-whatsapp-4dad` | rama del #1 | xAI, Flow y WhatsApp, con el simulador |
| 3 | [#3](https://github.com/leonardo826/Brazo-Derecho/pull/3) | `cursor/beta-onboarding-admin-cbfd` | rama del #2 | Primer uso, administración y modo simulado |
| 4 | [#4](https://github.com/leonardo826/Brazo-Derecho/pull/4) | `cursor/correo-catalogo-91bd` | rama del #3 | Correo simulado, recuperación de clave y catálogo |
| 5 | este PR | `cursor/ci-firmas-cupo-5a4c` | `cursor/correo-catalogo-91bd` | CI, firmas de webhooks, cupo mensual y docs de salida |

## Cómo mergear

1. Revisar y mergear el #1 en `main`.
2. Cambiar la base del #2 a `main`. El diff tiene que mostrar solo los commits de ese PR. Mergear el #2.
3. Igual con el #3, después el #4, y al final este.
4. Si GitHub todavía muestra commits del padre, rebase de la rama hija sobre `main` (o sobre la cabeza ya mergeada) y recién ahí mergear.

No se salta uno. El #4 no parte sin el panel del #3, y este PR no parte sin el correo y el catálogo del #4.

Cada PR tiene que seguir verde en CI (typecheck, lint, unitarias, integración con Postgres y Playwright) antes de mergearlo. El modo simulado, sin claves, tiene que seguir funcionando en `main`.
