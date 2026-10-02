import { webcrypto } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const required = [
  'CLOUDFLARE_D1_DATABASE_ID',
  'SIGNING_KEY_ID',
  'SIGNING_PRIVATE_KEY_JWK',
  'VERIFICATION_KEYS_JWKS',
  'CERTIFICATE_ISSUANCE_TOKEN',
];
for (const key of required)
  if (!process.env[key]) throw new Error(`Missing deployment setting: ${key}`);
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID;
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(databaseId) ||
  databaseId === '00000000-0000-0000-0000-000000000000'
)
  throw new Error('Invalid production D1 id');
const privateKey = JSON.parse(process.env.SIGNING_PRIVATE_KEY_JWK);
const publicKeys = JSON.parse(process.env.VERIFICATION_KEYS_JWKS).keys;
const active = publicKeys.find((key) => key.kid === process.env.SIGNING_KEY_ID);
if (
  !active ||
  publicKeys.some((key) => key.d) ||
  active.x !== privateKey.x ||
  privateKey.crv !== 'Ed25519' ||
  !privateKey.d
)
  throw new Error('Invalid signing configuration');
const signingKey = await webcrypto.subtle.importKey('jwk', privateKey, 'Ed25519', false, ['sign']);
const verificationKey = await webcrypto.subtle.importKey(
  'jwk',
  { kty: active.kty, crv: active.crv, x: active.x },
  'Ed25519',
  false,
  ['verify'],
);
const challenge = new TextEncoder().encode('squai-deployment-key-check');
if (
  !(await webcrypto.subtle.verify(
    'Ed25519',
    verificationKey,
    await webcrypto.subtle.sign('Ed25519', signingKey, challenge),
    challenge,
  ))
)
  throw new Error('Signing key pair does not match');
if (process.env.CERTIFICATE_ISSUANCE_TOKEN.length < 32)
  throw new Error('Issuance token must contain at least 32 characters');
const config = JSON.parse(await readFile('wrangler.json', 'utf8'));
config.name = 'squai-backend';
config.d1_databases[0].database_id = databaseId;
config.d1_databases[0].database_name = 'squai-certificates';
config.vars.SIGNING_KEY_ID = process.env.SIGNING_KEY_ID;
config.vars.VERIFICATION_KEYS_JWKS = process.env.VERIFICATION_KEYS_JWKS;
config.vars.API_ORIGIN = 'https://api.squai.io';
config.routes = ['api.squai.io', 'www.verify.squai.io'].map((pattern) => ({
  pattern,
  custom_domain: true,
}));
config.workers_dev = false;
config.preview_urls = false;
await writeFile('wrangler.deploy.json', JSON.stringify(config, null, 2));
await writeFile(
  '.deployment-secrets.json',
  JSON.stringify({
    SIGNING_PRIVATE_KEY_JWK: process.env.SIGNING_PRIVATE_KEY_JWK,
    CERTIFICATE_ISSUANCE_TOKEN: process.env.CERTIFICATE_ISSUANCE_TOKEN,
  }),
  { mode: 0o600 },
);
console.log('Deployment configuration validated');
