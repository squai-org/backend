# SQUAI backend

Cloudflare Workers backend for SQUAI business capabilities. The first module issues and verifies certificates using the supplied Programa and Charla designs. The repository is a modular monolith with clean layers inside each module, rather than a certificate-specific service framework.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/modules/<capability>/domain` | Business data and validation, independent of frameworks and infrastructure |
| `src/modules/<capability>/application` | Use cases and dependency interfaces |
| `src/modules/<capability>/infrastructure` | Persistence and cryptographic adapters |
| `src/modules/<capability>/presentation` | HTTP routes and versioned rendering templates |
| `src/modules/<capability>/module.ts` | Explicit dependency composition |
| `src/platform` | Worker bindings, authentication and HTTP error mapping |
| `src/shared` | Small framework-independent primitives |
| `src/app.ts` | Business module registration and HTTP policies |

Business use cases depend on `CertificateRepository`, `CredentialCryptography` and `Clock`. D1 and Web Crypto implement those interfaces. The fixed template registry selects a rendering strategy. Composition uses constructor injection; there is no service container, generic repository framework or ORM. New capabilities get their own module and versioned routes.

SOLID is applied through narrow ports, dependency inversion and separation of use cases from adapters. KISS favors a single deployable Worker, direct prepared SQL and explicit composition. The requested “YANG” principle is interpreted as YAGNI: no speculative event bus, CQRS framework, administration UI or extra business modules. PDF presentation is limited to the requested certificate download and viewer. Code comments are prohibited and the architecture check enforces that policy for source, test and script files. Explanations belong in documentation.

## Local development

Use Node.js 24.19.0 or newer and npm. PNPM is unnecessary for this single-package repository. All dependencies are pinned in `package.json` and `package-lock.json`.

```sh
npm ci
npm run keys:generate
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Copy the generated values into `.dev.vars`, preserving the JSON strings with single-quoted values as shown in the example. Never commit the private JWK or issuance token. Key generation writes secrets to your terminal; run it only in a trusted terminal, not in CI logs. The issuance token is for trusted server callers and must never be embedded in a public frontend.

```sh
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm run test:coverage
npm run build
npx wrangler deploy --dry-run
```

`npm run check` runs local lint, architecture checks, type checking, unit tests, Workers/D1 integration tests with coverage and build validation. Integration tests run the bundled Worker in Miniflare/workerd, use a real local D1 database and apply the production schema. They do not use mocked SQL. A second integration harness executes the HTTP and persistence adapters in-process against real local D1 so the coverage sent to Sonar includes those layers as well as the core use cases. No Cloudflare account or production secrets are required for tests.

## API

| Method | Route | Access | Result |
| --- | --- | --- | --- |
| GET | `/health` | Public | Worker liveness |
| POST | `/api/v1/certificates` | Bearer issuance token | New certificate: 201; identical issuance: 200 |
| GET | `/verify/:hash` | Public | Responsive viewer of the verified PDF, with open and download links |
| GET | `/api/v1/certificates/:hash/pdf` | Public | One-page Letter landscape `application/pdf`; `?download=1` requests attachment |
| GET | `/api/v1/certificates/:hash` | Public | Verified metadata and secured credential |
| GET | `/api/v1/certificates/:hash/credential` | Public | `application/vc+jwt` credential |
| GET | `/.well-known/jwks.json` | Public | Current and historical public keys |

Issue one certificate per request:

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

Use `talk-v1` for attendance at a talk. `subjectId` is a stable opaque UUID assigned by the issuing application, not an email or identity-document number. Reuse that UUID when retrying issuance. Two people with the same name do not collide. The request contract is an explicit object rather than a positional array so field meanings remain stable. Unknown properties and templates are rejected. Text must be trimmed, NFC-normalized, well-formed Unicode without control or bidirectional override characters; name and course limits are 80 and 100 code points. Completion dates must be real `YYYY-MM-DD` dates. Authenticated request bodies are limited to 8 KiB.

Send `Authorization: Bearer <server-token>` and `Content-Type: application/json` to `https://api.squai.io/api/v1/certificates`. Production sets `API_ORIGIN=https://api.squai.io`; issuance on the verification domains or production preview URLs returns 404, even with a valid token. When `API_ORIGIN` is unset, local development retains its existing single-origin behavior. The response contains `hash`, `verificationUrl`, `templateId`, `signature`, `keyId`, `credential` and `credentialJwt`. The canonical public link is `https://www.verify.squai.io/verify/<64-character-hash>`. The viewer and PDF endpoints validate independently of the issuance endpoint and do not require the private key. Public metadata, credential and PDF reads remain available on the verification host for compatibility; they are also reachable on the API host.

| Status | Meaning |
| --- | --- |
| 400 | Invalid input, date, template or hash |
| 401 | Missing or invalid issuance token |
| 404 | Certificate or route not found |
| 409 | Certificate integrity verification failed |
| 413 | Body exceeds 8 KiB |
| 415 | Unsupported request content type |
| 503 | Issuance token is not configured |
| 500 | Infrastructure or configuration failure; internal details are not returned |

Errors use `{ "error": { "code": "...", "requestId": "..." } }`. Logs contain the correlation ID and error class, never certificate contents, credentials, tokens or keys.

## Integrity and interoperability

The SHA-256 input is a recursively key-sorted JSON envelope containing `version`, `issuer`, `templateId` and `data`. Object property order does not change the hash. Version and template are signed along with the achievement. The random subject UUID also prevents predictable links based only on names and course dates. Ed25519 signs the 32 raw digest bytes, and its detached signature is encoded as unpadded base64url.

The application additionally issues a W3C Verifiable Credentials Data Model 2.0 document secured through JOSE compact JWS with `alg=EdDSA`, `typ=vc+jwt` and a public-key URL in `kid`. The credential contains standard context, types, issuer, credential ID, subject ID and `validFrom`, with an inline vocabulary for SQUAI achievement fields. A hash signature alone is not presented as a W3C Data Integrity cryptosuite.

Before returning a viewer, PDF, JSON or a credential download, verification recomputes the hash, verifies its signature, validates the input and issuer, verifies the JWS profile and compares the entire secured credential against the stored record. Tampered payload, template, hash, signature, key identifier or issuance timestamp prevents successful verification. Unknown keys fail closed. Consumers should download the credential, retrieve the key matching `kid` from the trusted SQUAI JWKS endpoint, verify the JWS and decide whether they trust the issuer. Cryptographic validity does not establish the truth of an educational achievement by itself.

D1 stores one row per hash. Transactional `INSERT ... ON CONFLICT DO NOTHING` plus read-back makes retries and concurrent issuance idempotent. SQL triggers prevent updates and deletes. Administrative access can bypass those triggers; the cryptographic checks remain necessary. The public viewer contains no recipient name, course text, input, editing panel or scripts in its HTML. Personal data is present inside the PDF and the existing public metadata/credential endpoints. Anyone with a verification URL can read those data; PDF presentation is not access control. Responses carry CSP, no-store and noindex headers. Viewer pages deny framing, and generated PDFs allow only same-origin framing so they can be embedded in the viewer. All viewer and PDF resources are served locally without Google Fonts or other external requests.

The Programa and Charla exports were converted from their React/DC preview wrappers into static server-rendered documents. Their backgrounds, logo geometry, seal, signatures, signer names and supplied legal footer are retained. Variable text is bounded to separate slots, the full hash link wraps within the footer, and the talk wording reads “asistió a la charla.” The generated PDF is exactly one Letter landscape page, 792 × 612 points (11 × 8.5 inches). The viewer container adapts to mobile and desktop widths; the browser provides PDF zoom and rendering. Browsers without an embedded PDF viewer can use the always-visible open or download links. The legal statement in the supplied template is reproduced as provided, not independently certified by this implementation.

### PDF generation without a paid rendering service

Cloudflare Browser Run is not used. Its free plan includes 10 browser minutes per day; on Workers Paid it includes 10 hours/month and then charges $0.09/browser hour, with additional concurrency charges for Browser Sessions. See [Browser Run pricing](https://developers.cloudflare.com/browser-run/pricing/).

The PDF feature adds no paid service, account binding, storage database, runtime dependency or per-document API charge. Existing Workers/D1 quotas still apply; unlimited hosting is not promised. `pdf-lib` 1.17.1, `@pdf-lib/fontkit` 1.1.1 and Playwright 1.63.0 are the npm latest versions verified on 2026-10-01 and are development dependencies only. They prepare the two fixed templates and local fonts outside the Worker. The deployed Worker appends bounded text, a clickable verification link and document metadata as a standard incremental PDF update. It does not launch a browser, parse fonts or rebuild the background per request. Bundled font licenses are included with the assets.

Prepared PDFs and their font/page manifest are committed together. To intentionally regenerate them, install a local Chromium once and run:

```sh
npx playwright install chromium
npm run templates:pdf
```

`CHROMIUM_EXECUTABLE_PATH` can select an existing Chromium executable. This export is an explicit development operation, not part of CI, deployment or a public request. Original versioned HTML designs remain unchanged. For visual changes after issuance, follow the template-versioning rule below.

Variable name and course text are fitted to fixed slots using the actual embedded glyph widths. The current supplied fonts support their bundled Latin character repertoire, including Spanish accents. Unsupported glyphs or an overflowing slot fail the PDF response instead of silently omitting text; issuance and the original credential remain available. New language coverage requires adding an appropriate font in a versioned presentation change.

The PDF is static and contains no form fields or JavaScript. It is generated only after hash, Ed25519 and VC-JWT validation succeeds. It is not an Adobe/PAdES digitally signed PDF, and editing a downloaded copy does not automatically invalidate its appearance or notify the server. The original VC-JWT remains the signed credential. Verify the original record using the official URL embedded in the PDF and compare its facts with any copy. A visitor controls their browser and can replace local content or forge a screenshot; no webpage or PDF can prevent that.

Keep versioned templates and assets unchanged after issuance. Visual changes require a new template ID, registry entry and additive schema migration; changing a file in place would alter an old certificate’s appearance without changing its signature. There are deliberately no expiration, revocation or correction routes in this first version. A future lifecycle requirement needs a separately designed status mechanism; do not delete historical records or keys as a substitute.

For key rotation, retain historical public JWKs in `VERIFICATION_KEYS_JWKS`, add a new unique `kid`, set `SIGNING_KEY_ID` to it, and replace the private signing JWK. Existing certificates remain signed by their original key and keep the same URL. The issuer identity, name and public origin are part of the credential profile and must remain stable; changing them requires an explicit migration strategy.

## CI and production setup

GitHub Actions owns both CI and CD. Pull requests to `main` and pushes to `main` run lint and comment/boundary checks, TypeScript, unit tests, Workers/D1 integration tests with coverage, build, Wrangler dry run and SonarCloud analysis with a blocking quality gate. The `Integration gate` job succeeds only if all validation succeeds. Dependencies and Actions are pinned; Dependabot proposes weekly updates.

Configure these repository settings before merging:

| Setting | Location |
| --- | --- |
| `SONAR_TOKEN` | Actions secret |
| `SONAR_PROJECT_KEY` | Actions variable |
| `SONAR_ORGANIZATION` | Actions variable |
| `main` requires pull requests and successful `Integration gate` | Branch protection or repository ruleset |

Create/import the project in SonarCloud and disable automatic analysis when using this CI scanner. The workflow intentionally fails if Sonar configuration is missing. Fork pull requests do not receive repository secrets and therefore cannot pass that gate until analyzed through a trusted branch. GitHub branch protection is a repository setting; a workflow file alone cannot prevent a manual merge. The repository initially had no ruleset and an unprotected `main`.

Create the Cloudflare D1 database and configure the GitHub `production` environment:

```sh
npx wrangler d1 create squai-certificates
```

| Setting | Production environment location |
| --- | --- |
| `CLOUDFLARE_D1_DATABASE_ID` | Variable containing the created database ID |
| `SIGNING_KEY_ID` | Variable containing the active short key ID |
| `VERIFICATION_KEYS_JWKS` | Variable containing public JWKs with short `kid` values |
| `CLOUDFLARE_API_TOKEN` | Secret scoped to the account, Worker, D1 and domain management needed for deployment |
| `CLOUDFLARE_ACCOUNT_ID` | Secret |
| `SIGNING_PRIVATE_KEY_JWK` | Secret |
| `CERTIFICATE_ISSUANCE_TOKEN` | Secret |

The Cloudflare account must manage the `squai.io` zone and be able to attach `api.squai.io`, `www.verify.squai.io` and `verify.squai.io` as Worker custom domains. Deployment explicitly retains both verification hosts and adds the API host. `PUBLIC_ORIGIN` stays `https://www.verify.squai.io` to preserve existing credential IDs and JWKS key URLs; a domain redirect does not require changing that signed identity. Set production environment deployment branches to `main`; configure reviewers if your operational policy requires them. Provisioning credentials and those account settings is separate from this source change.

CD runs only on validated `main` commits. It validates the signing key pair, prepares a production configuration, applies additive D1 migrations, deploys the Worker with its secrets in the same version, then checks health, public-key discovery, D1/PDF lookup, issuance authentication on `api.squai.io`, and rejection of issuance on the frontend domain. Secret files are private, ignored and removed after the job. `wrangler.json` contains an explicit local-only database ID; production deployment is prepared by `scripts/prepare-deployment.mjs`, which rejects that placeholder. A failed deployment must be inspected before retrying; do not roll back or delete an already-applied production migration blindly.

## Versions and source validation

Versions were checked against npm’s `latest` tags on 2026-09-30. Hono 4.13.12, JOSE 6.2.12, TypeScript 7.0.2, Vitest 5.0.3, Biome 2.5.15 and Wrangler 4.145.0 are pinned. The current Wrangler dependency and npm latest tag use Miniflare 5.20260930.0-alpha, so the same version is used for development/integration testing; Miniflare is not part of the deployed Worker. The latest typescript-eslint declares TypeScript support below 6.1, so Biome was selected instead of downgrading TypeScript or overriding peer dependencies. Node 24.19.0 is the current installed supported LTS runtime used for validation.

Cloudflare’s current Workers Free limits are 100,000 requests/day and **10 ms CPU per HTTP request**, rather than 30 ms. D1 Free includes 5 million rows read/day, 100,000 rows written/day and 5 GB total account storage, with a 500 MB maximum database. Actual production CPU usage, quotas and billing must be measured after deploying; passing local functional tests does not establish that every request fits the free-plan CPU budget.

Primary references:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers Web Crypto algorithms](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [Hono on Workers](https://hono.dev/docs/getting-started/cloudflare-workers)
- [Workers testing with Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/writing-tests/)
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Securing Verifiable Credentials using JOSE and COSE](https://www.w3.org/TR/vc-jose-cose/)
- [RFC 8785 canonicalization rationale](https://www.rfc-editor.org/rfc/rfc8785)
- [Workers GitHub Actions deployment](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
- [SonarCloud GitHub Actions analysis](https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/ci-based-analysis/github-actions-for-sonarcloud/)
