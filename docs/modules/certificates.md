# Certificados

Emisión idempotente, verificación criptográfica y presentación en PDF. Esta página contiene las particularidades del módulo; arquitectura, herramientas y operación compartida se referencian desde el [README](../../README.md), [CI/CD](../platform/ci-cd.md) y [Cloudflare](../platform/cloudflare.md).

## Contrato HTTP

| Método | Ruta | Resultado |
| --- | --- | --- |
| POST | `/api/v1/certificates` | Emisión con bearer token: 201 nuevo, 200 reintento idéntico |
| GET | `/verify/:hash` | Visor responsive, con apertura y descarga del PDF |
| GET | `/api/v1/certificates/:hash/pdf` | PDF inline; `?download=1` solicita descarga |
| GET | `/api/v1/certificates/:hash` | Metadatos y credencial verificados |
| GET | `/api/v1/certificates/:hash/credential` | Credencial `application/vc+jwt` |
| GET | `/.well-known/jwks.json` | Claves públicas actuales e históricas |

En producción, emite en `https://api.squai.io/api/v1/certificates`, con `Authorization: Bearer <token>` y `Content-Type: application/json`:

```json
{
  "templateId": "program-v1",
  "data": {
    "subjectId": "urn:uuid:63dfcaba-e0cd-45fd-98a2-b596fe87c183",
    "recipientName": "José Sebastián Rico",
    "courseName": "Fundamentos de Inteligencia Artificial",
    "completedOn": "2026-09-30"
  }
}
```

`program-v1` acredita un programa; `talk-v1`, asistencia a una charla. `subjectId` es un UUID opaco y estable del destinatario; reutilízalo al reintentar. No uses un correo o número de identidad.

El cuerpo admite hasta 8 KiB, nombre hasta 80 puntos de código y curso hasta 100. El texto debe estar recortado y normalizado en NFC, sin controles ni caracteres de dirección prohibidos. La fecha debe ser real y tener formato `YYYY-MM-DD`. Propiedades y plantillas desconocidas se rechazan.

La respuesta mantiene `hash`, `verificationUrl`, `templateId`, `signature`, `keyId`, `credential` y `credentialJwt`. El enlace canónico es `https://www.verify.squai.io/verify/<hash>`. Todos los endpoints de backend, incluidos `/health`, metadatos, VC-JWT, PDF y JWKS, se atienden únicamente en `https://api.squai.io`. En el frontend devuelven 404. `/verify/:hash` y los recursos de visualización pertenecen a `www.verify.squai.io`; una visita a esa ruta en la API redirige al frontend. No se registra `verify.squai.io` en los nuevos despliegues.

| Estado | Caso |
| --- | --- |
| 400 / 415 | Datos inválidos / tipo de contenido incorrecto |
| 401 / 503 | Token inválido / token de emisión no configurado |
| 404 | Registro o ruta inexistente |
| 409 | Fallo de integridad |
| 413 | Cuerpo demasiado grande |
| 500 | Fallo de infraestructura, configuración o presentación |

Errores: `{ "error": { "code": "...", "requestId": "..." } }`. Los logs de error registran correlación y clase, sin contenido del certificado ni secretos.

## Configuración adicional

| Nombre | Uso | Ubicación de producción |
| --- | --- | --- |
| `SIGNING_KEY_ID` | `kid` corto de la clave activa | Variable de `production` |
| `VERIFICATION_KEYS_JWKS` | JSON con claves públicas y sus `kid` | Variable de `production` |
| `SIGNING_PRIVATE_KEY_JWK` | JWK privado Ed25519 | Secret de `production` |
| `CERTIFICATE_ISSUANCE_TOKEN` | Autorización de emisores de confianza | Secret de `production` |
| `PUBLIC_ORIGIN` | Origen canónico de credenciales y JWKS | Configuración del despliegue |
| `API_ORIGIN` | Host permitido para emisión | `https://api.squai.io` en producción |
| `ISSUER_ID`, `ISSUER_NAME` | Identidad del emisor | Configuración del despliegue |

El módulo usa los bindings `DB` y `ASSETS`. La preparación de CD valida el par de claves. Configura los dominios personalizados en la zona `squai.io` de la cuenta destino.

Para completar la configuración local del README:

```sh
npm run keys:generate
```

Copia los valores generados a `.dev.vars`, conservando el JSON entre comillas simples como en el ejemplo. Este comando muestra secretos: ejecútalo en un terminal de confianza, fuera de logs de CI. Nunca publiques el token en un frontend. Sin `API_ORIGIN`, el entorno local conserva emisión y consulta en un mismo origen.

Para rotar claves, conserva las públicas históricas en JWKS, añade un `kid` nuevo y reemplaza ID activo y clave privada. Conserva identidad del emisor y `PUBLIC_ORIGIN`: forman parte del perfil firmado. Los nuevos `kid` usan `API_ORIGIN`; los históricos siguen admitiéndose y aparecen como alias en JWKS. La ruta antigua de JWKS en el frontend sólo redirige con 308 a la API para mantener descubrimiento externo. CORS permite lecturas desde `PUBLIC_ORIGIN`, sin credenciales ni acceso desde otros orígenes.

## Integridad y exposición de datos

SHA-256 identifica un JSON de claves ordenadas con versión, emisor, plantilla y datos. Ed25519 firma sus 32 bytes; además, JOSE asegura una credencial W3C VC 2.0 como JWS `EdDSA` con `typ=vc+jwt`. Cada lectura comprueba hash, firma, emisor, clave y correspondencia completa de la credencial. Un registro alterado no se presenta como válido.

D1 conserva una fila por hash. Inserción transaccional con conflicto y lectura posterior permite reintentos concurrentes; triggers impiden actualizar o borrar registros. No hay rutas de revocación, corrección o expiración. No elimines registros ni claves históricas para simular esos procesos.

Las URL dentro de `@context` identifican términos y tipos semánticos; no son rutas de la API. `@protected` protege definiciones JSON-LD, no impide editar una página en DevTools.

El HTML del visor no incluye nombre ni curso. **El PDF y los endpoints de metadatos/credencial son públicos para quien conozca el enlace**. PDF no añade control de acceso. Las respuestas usan CSP, `no-store` y `noindex`; los recursos del visor se sirven sin dependencias externas.

El PDF no tiene formularios ni JavaScript, pero tampoco firma Adobe/PAdES. Un archivo descargado, una captura o contenido local del navegador pueden modificarse. La autenticidad se comprueba contra el registro oficial y el VC-JWT firmado; la apariencia de una copia no la garantiza.

## PDF y plantillas

Cada PDF contiene una página Letter horizontal de 792 × 612 puntos, fondo completo, información, fuentes embebidas y enlace de verificación. PDF.js muestra la página completa en un canvas ajustado al ancho y alto disponibles, sin iframe, barras del lector nativo ni scroll propio. El PDF se obtiene desde el host API. Apertura y descarga se mantienen como alternativas ante JavaScript deshabilitado o fallos de renderizado; la descarga permite acceso al texto del PDF con tecnologías de asistencia.

No se utiliza Cloudflare Browser Run ni una API de renderizado de pago. `pdf-lib`, `@pdf-lib/fontkit` y Playwright son dependencias de desarrollo: preparan los fondos y manifiestos fuera del Worker. En la solicitud, el Worker añade texto y enlace mediante una actualización incremental del PDF. JOSE es la dependencia específica de runtime; hashing y Ed25519 usan Web Crypto. PDF.js 6.3.289, verificado contra npm latest el 2026-10-01, se empaqueta como recursos estáticos para el navegador; no renderiza PDF dentro del Worker ni utiliza CDN. La licencia se incluye en esos recursos.

Para regenerar intencionalmente los archivos preparados:

```sh
npx playwright install chromium
npm run templates:pdf
```

`CHROMIUM_EXECUTABLE_PATH` permite usar Chromium ya instalado. La exportación no se ejecuta en CI ni durante una solicitud. Versiona PDF y manifiesto juntos. Cambios visuales posteriores a una emisión requieren nuevo ID de plantilla, registro y migración aditiva; no reemplaces un diseño histórico.

Las fuentes actuales cubren su repertorio latino, incluidos acentos españoles. Un glifo no disponible o texto que no cabe provoca fallo del PDF; la emisión y la credencial original permanecen disponibles. Otro repertorio requiere una nueva versión con fuentes adecuadas.

## Métricas y generación masiva

Validación local del **2026-10-01** para la separación de dominios y el visor PDF.js. Las métricas son de desarrollo; CPU de producción sigue pendiente.

| Métrica | Resultado / alcance |
| --- | --- |
| Pruebas | 88 unitarias e integración aprobadas, más renderizado en navegador |
| Cobertura de líneas | 97,96% en la ejecución local; detalle en `coverage/lcov.info` |
| Worker | Aproximadamente 103 KiB sin comprimir; 31 KiB gzip en dry run |
| Fondos PDF preparados | Aproximadamente 1,37–1,40 MB cada uno, antes del texto variable |
| CPU del endpoint en Cloudflare | Pendiente de medir en producción; las pruebas locales no certifican el presupuesto Free |

En Workers Free, **toda la solicitud del PDF debe respetar 10 ms de CPU**, incluyendo validación criptográfica, composición y serialización. La espera a D1 o assets no cuenta como CPU. Como objetivo inicial proponemos p95 ≤8 ms, p99 <10 ms y cero errores `exceededCpu`; son objetivos de operación, no controles implementados ni garantías medidas.

La emisión no genera el PDF: se genera al pedir su endpoint, después de verificar el registro. No hay API de lote ni ZIP. En masa, conserva solicitudes individuales y controla la concurrencia desde el cliente; empieza con dos solicitudes simultáneas y aumenta únicamente después de medir. Este punto de partida no garantiza una tasa de certificados por segundo.

| Acción por certificado | Solicitudes HTTP de aplicación mínimas |
| --- | --- |
| Emitir | 1 |
| Obtener PDF directamente | 1 adicional |
| Abrir visor y cargar PDF | Al menos 4: HTML, script, worker de PDF.js y PDF |
| Descargar después | 1 adicional; vuelve a generar PDF |

Por ejemplo, 10.000 emisiones más una petición directa del PDF por certificado suman **20.000 solicitudes**, sin reintentos ni otro tráfico. El navegador puede añadir peticiones. Las respuestas `no-store` no amortizan visitas posteriores mediante caché.

Una emisión nueva normalmente ejecuta un SELECT previo y un batch INSERT + SELECT. Cada consulta de verificación ejecuta un SELECT por hash. Estas operaciones no equivalen a filas facturadas: mide `rows_read`/`rows_written`, incluidos índices, para calcular capacidad. Los PDF no se almacenan en D1.

Las ráfagas comparten memoria, capacidad D1 y cuotas con otros módulos. No calcules concurrencia como 128 MB divididos por tamaño del PDF: hay buffers, copias y runtime. Usa el margen y supervisión de la [guía Cloudflare](../platform/cloudflare.md), y reduce o detén el lote cuando haya sobrecarga o agotamiento.

Referencias: [VC 2.0](https://www.w3.org/TR/vc-data-model-2.0/), [VC-JOSE-COSE](https://www.w3.org/TR/vc-jose-cose/), [Web Crypto en Workers](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).

## Pruebas de presentación

```sh
npx playwright install chromium
npm run test:browser
```

CI instala Chromium y ejecuta ambos diseños en 320×568, 390×844, 768×1024, 1366×768, 1920×1080 y 844×390. Comprueba página completa visible, proporción Letter, ausencia de scroll y controles nativos, descarga y errores JavaScript. Son viewports emulados en Chromium, no dispositivos físicos ni cobertura de todos los navegadores. Las capturas se guardan en `test-results/`.
