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

Referencia: [análisis de SonarCloud con GitHub Actions](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud/).
