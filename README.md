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

SOLID is applied through narrow ports, dependency inversion and separation of use cases from adapters. KISS favors a single deployable Worker, direct prepared SQL and explicit composition. The requested “YANG” principle is interpreted as YAGNI: no speculative event bus, CQRS framework, PDF engine, administration UI or extra business modules. Code comments are prohibited and the architecture check enforces that policy for source, test and script files. Explanations belong in documentation.

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
| GET | `/verify/:hash` | Public | Verified read-only HTML document |
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

Send `Authorization: Bearer <server-token>` and `Content-Type: application/json` to the POST route. The response contains `hash`, `verificationUrl`, `templateId`, `signature`, `keyId`, `credential` and `credentialJwt`. The canonical public link is `https://www.verify.squai.io/verify/<64-character-hash>`. The HTML endpoint validates independently of the issuance endpoint and does not require the private key.

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

Before returning HTML, JSON or a credential download, verification recomputes the hash, verifies its signature, validates the input and issuer, verifies the JWS profile and compares the entire secured credential against the stored record. Tampered payload, template, hash, signature, key identifier or issuance timestamp prevents successful verification. Unknown keys fail closed. Consumers should download the credential, retrieve the key matching `kid` from the trusted SQUAI JWKS endpoint, verify the JWS and decide whether they trust the issuer. Cryptographic validity does not establish the truth of an educational achievement by itself.

D1 stores one row per hash. Transactional `INSERT ... ON CONFLICT DO NOTHING` plus read-back makes retries and concurrent issuance idempotent. SQL triggers prevent updates and deletes. Administrative access can bypass those triggers; the cryptographic checks remain necessary. Public verification contains no input, editing panel or scripts. Request values are escaped as text. Responses carry CSP, no-store, anti-framing and noindex headers. Original template assets are served locally; Google Fonts is the only external resource used by the views.

The Programa and Charla exports were converted from their React/DC preview wrappers into static server-rendered documents. Their backgrounds, logo geometry, seal, signatures, signer names and supplied legal footer are retained. Variable text is bounded to separate slots, the full hash link wraps within the footer, and the talk wording reads “asistió a la charla.” The certificate stays landscape, with horizontal scrolling on small screens and a Letter landscape print layout. The legal statement in the supplied template is reproduced as provided, not independently certified by this implementation.

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

The Cloudflare account must manage the `squai.io` zone and be able to attach `www.verify.squai.io` as a Worker custom domain. Set production environment deployment branches to `main`; configure reviewers if your operational policy requires them. Provisioning credentials and those account settings is separate from this source change.

CD runs only on validated `main` commits. It validates the signing key pair, prepares a production configuration, applies additive D1 migrations, deploys the Worker with its secrets in the same version, then checks health, public-key discovery, D1 reads and issuance authentication. Secret files are private, ignored and removed after the job. `wrangler.json` contains an explicit local-only database ID; production deployment is prepared by `scripts/prepare-deployment.mjs`, which rejects that placeholder. A failed deployment must be inspected before retrying; do not roll back or delete an already-applied production migration blindly.

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
