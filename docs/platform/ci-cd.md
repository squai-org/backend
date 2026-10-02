# CI y CD

Implementación: [backend.yml](../../.github/workflows/backend.yml). El resumen del flujo está en el [README](../../README.md).

## Configuración de GitHub

| Nombre | Ubicación | Valor |
| --- | --- | --- |
| `SONAR_TOKEN` | Secret del repositorio | Token con permiso de análisis |
| `SONAR_PROJECT_KEY` | Variable del repositorio | Clave del proyecto SonarCloud |
| `SONAR_ORGANIZATION` | Variable del repositorio | Organización SonarCloud |
| `CLOUDFLARE_API_TOKEN` | Secret del environment `production` | Token limitado a los recursos necesarios para Workers, D1 y dominios |
| `CLOUDFLARE_ACCOUNT_ID` | Secret del environment `production` | ID de la cuenta Cloudflare |
| `CLOUDFLARE_D1_DATABASE_ID` | Variable del environment `production` | ID de la base creada |

Configura el environment `production` para permitir despliegues desde `main`. Protege `main` exigiendo PR y el check `Integration gate`; el archivo del workflow no impide por sí mismo un merge manual. Las variables y secretos particulares del negocio están en la [documentación del módulo](../modules/index.md).

## SonarCloud

En el proyecto, abre **Administration → Analysis Method** y desactiva **Automatic Analysis**. El scanner de GitHub Actions realiza el análisis y espera su quality gate; mantener ambos métodos activos provoca conflictos.

La ausencia de configuración bloquea CI. Los PR de forks no reciben secretos: necesitan análisis desde una rama de confianza para superar este gate.

## Despliegue

Crea primero la base D1 en la cuenta destino. La configuración de producción actual espera el nombre `squai-certificates`:

```sh
npx wrangler d1 create squai-certificates
```

Guarda el ID devuelto en `CLOUDFLARE_D1_DATABASE_ID`. El ID de [wrangler.json](../../wrangler.json) es exclusivamente local; [prepare-deployment.mjs](../../scripts/prepare-deployment.mjs) lo reemplaza y rechaza el placeholder en producción.

CI también ejecuta el navegador de los módulos que lo requieren; sus instrucciones están en cada documento funcional.

CD prepara configuración y secretos, aplica migraciones aditivas, publica el Worker y comprueba los endpoints mediante [smoke-test.mjs](../../scripts/smoke-test.mjs). Los archivos temporales de secretos se eliminan al finalizar. Dependencias y Actions están fijadas; Dependabot propone actualizaciones.

Ante un fallo, revisa qué etapas se ejecutaron antes de repetir. Revertir el Worker no revierte una migración aplicada: evita borrar o deshacer datos de producción sin un procedimiento específico.

## Smoke test después del despliegue

El build incorpora el SHA del commit y el Worker devuelve `X-Deployment-Version` en sus respuestas. CD exige el SHA de la ejecución mediante `SMOKE_EXPECTED_VERSION`: primero espera `/health` en el dominio de API y luego comprueba la versión en cada contrato. Un fallo de readiness omite los demás checks y hace fallar el job; un fallo independiente permite recoger los resultados restantes.

Cada intento tiene un timeout nuevo de 10 segundos, incluyendo la lectura del contenido. La suite tiene un presupuesto de 90 segundos y un máximo de cuatro intentos por check, con espera exponencial y jitter. Solo se reintentan fallos de red temporales, timeouts, respuestas 408, 429, 500, 502–504 y 520–524, o una versión anterior. Los 404 de assets nuevos tienen una ventana de 30 segundos desde el inicio de la suite. Se respeta `Retry-After` en 429 y 503 sin superar el presupuesto. Errores de contrato, certificados TLS inválidos y otros estados inesperados fallan sin reintento; los 401 y 404 previstos son resultados válidos.

Los logs JSON identifican check, método, URL, intento, estado HTTP, duración, tipo de contenido, versión, `X-Request-Id`, `CF-Ray` y categoría de error. No guardan cuerpos de respuesta, credenciales ni mensajes de excepciones. Las redirecciones se inspeccionan sin seguirlas automáticamente.

GitHub muestra una tabla en el resumen del job y conserva `report.json` y `summary.md` en el artefacto `smoke-<sha>-<intento>` durante siete días, también si falla la suite. `recovered` indica que un check necesitó reintentos; `skipped` nunca cuenta como éxito. Un smoke fallido marca CD como fallido, pero no revierte automáticamente el Worker ya publicado ni las migraciones.

Para repetir solo las comprobaciones públicas desde una copia del repositorio:

```sh
SMOKE_EXPECTED_VERSION=<sha-desplegado> node scripts/smoke-test.mjs
```

Sin `SMOKE_EXPECTED_VERSION` se validan los contratos, pero no la revisión desplegada. Los contratos de cada módulo se documentan junto a la feature; el motor compartido está en `scripts/smoke/runner.mjs`. Sus pruebas unitarias simulan propagación, timeouts, presupuestos y fallos permanentes; las de integración ejecutan los contratos contra el Worker compilado con Miniflare.

Referencia: [análisis de SonarCloud con GitHub Actions](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud/).
