# SQUAI Backend

[![CI](https://img.shields.io/github/actions/workflow/status/squai-org/backend/backend.yml?branch=main&label=CI)](https://github.com/squai-org/backend/actions/workflows/backend.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.19.0-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Arquitectura](https://img.shields.io/badge/architecture-modular_monolith-7C8CFF)](#arquitectura)
[![Cloudflare Workers](https://img.shields.io/badge/runtime-Cloudflare_Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Licencia MIT](https://img.shields.io/badge/license-MIT-44D4C8)](LICENSE)

Backend de las capacidades de negocio de SQUAI. Cada capacidad tiene su propio módulo dentro de un único despliegue.

## Arquitectura

Monolito modular con arquitectura limpia y puertos/adaptadores. Dominio y aplicación son independientes de HTTP, persistencia y proveedor. Cada módulo compone sus dependencias mediante inyección por constructor.

SOLID, KISS y YAGNI guían la implementación. La validación automatizada controla las dependencias entre capas y prohíbe comentarios en el código; las explicaciones pertenecen a la documentación.

## Estructura

| Ubicación | Responsabilidad |
| --- | --- |
| `src/modules/<modulo>/domain` | Reglas y datos de negocio |
| `src/modules/<modulo>/application` | Casos de uso y puertos |
| `src/modules/<modulo>/infrastructure` | Adaptadores de servicios y persistencia |
| `src/modules/<modulo>/presentation` | Rutas y representación HTTP |
| `src/modules/<modulo>/module.ts` | Composición de dependencias |
| `src/platform`, `src/shared` | Integración con la plataforma y primitivas compartidas |
| `src/app.ts`, `src/index.ts` | Registro de módulos y entrada del runtime |
| `tests/unit`, `tests/integration` | Pruebas de unidades y del Worker con D1 local real |
| `migrations`, `public`, `scripts` | Esquema, recursos estáticos y herramientas |
| `docs/modules`, `docs/platform` | Documentación funcional y operativa |

## Frameworks y herramientas

TypeScript y Hono para HTTP; esbuild y Wrangler para compilación y despliegue; Vitest y Miniflare/workerd para pruebas; Biome y SonarCloud para calidad.

Se utiliza npm. Las versiones exactas están fijadas en [package.json](package.json) y [package-lock.json](package-lock.json). Las dependencias particulares se describen en cada módulo.

## Nubes soportadas

**Cloudflare**: Workers ejecuta HTTP, D1 aporta persistencia mediante adaptadores y Static Assets sirve recursos. Wrangler configura y despliega estos componentes; consulta [operación y límites](docs/platform/cloudflare.md).

Otras nubes requieren implementar entrada del runtime, bindings, adaptadores de persistencia y despliegue. Actualmente no tienen una integración disponible.

## Levantamiento local

Requiere Node.js ≥24.19.0.

```sh
npm ci
cp .dev.vars.example .dev.vars
```

Completa `.dev.vars` siguiendo la [documentación de los módulos](docs/modules/index.md). Después:

```sh
npm run db:migrate:local
npm run dev
```

El Worker escucha en `http://localhost:8787`; `GET /health` comprueba disponibilidad. Los secretos locales no se versionan. `npm run check` ejecuta lint, reglas de arquitectura, tipos, pruebas con cobertura y build; las pruebas no requieren una cuenta de Cloudflare.

## CI y CD

GitHub Actions valida PR y cambios a `main`: lint, tipos, pruebas unitarias e integración, build, Wrangler y SonarCloud con quality gate bloqueante. `Integration gate` reúne el resultado.

Tras validar `main`, CD aplica migraciones, despliega en Cloudflare y ejecuta smoke tests. Configuración y protección de ramas: [CI/CD](docs/platform/ci-cd.md).

## Documentación

- [Módulos y criterio de documentación](docs/modules/index.md)
- [Cloudflare: cuotas y operación](docs/platform/cloudflare.md)
- [CI/CD: configuración](docs/platform/ci-cd.md)
