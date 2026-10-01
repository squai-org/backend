export interface Bindings {
  DB: D1Database;
  ASSETS: Fetcher;
  PUBLIC_ORIGIN: string;
  ISSUER_ID: string;
  ISSUER_NAME: string;
  SIGNING_KEY_ID: string;
  SIGNING_PRIVATE_KEY_JWK?: string;
  VERIFICATION_KEYS_JWKS: string;
  CERTIFICATE_ISSUANCE_TOKEN?: string;
}

export type HttpEnvironment = { Bindings: Bindings; Variables: { requestId: string } };
