import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Miniflare } from 'miniflare';
import { createKeys, issuer, publicOrigin } from './fixtures';

export const token = 'integration-test-issuance-token-32-characters';
export const schema = await readFile('migrations/0001_certificates.sql', 'utf8');

export async function createTestRuntime(apiOrigin?: string) {
  const keys = await createKeys();
  const values = {
    PUBLIC_ORIGIN: publicOrigin,
    ISSUER_ID: issuer.id,
    ISSUER_NAME: issuer.name,
    SIGNING_KEY_ID: keys.kid,
    SIGNING_PRIVATE_KEY_JWK: keys.privateJwk,
    VERIFICATION_KEYS_JWKS: keys.jwks,
    CERTIFICATE_ISSUANCE_TOKEN: token,
    ...(apiOrigin ? { API_ORIGIN: apiOrigin } : {}),
  };
  const runtime = new Miniflare({
    workers: [
      {
        config: {
          name: 'certificates-test',
          compatibilityDate: '2026-09-30',
          manifest: {
            mainModule: 'worker.js',
            modulesRoot: resolve('dist'),
            modules: {
              'worker.js': { type: 'esm', contents: await readFile('dist/worker.js', 'utf8') },
            },
          },
          assets: { directory: resolve('public'), hasUserWorker: true, runWorkerFirst: true },
          env: {
            ...Object.fromEntries(
              Object.entries(values).map(([name, value]) => [
                name,
                { type: 'text' as const, value },
              ]),
            ),
            DB: { type: 'd1', id: 'certificates-test' },
            ASSETS: { type: 'assets' },
          },
        },
      },
    ],
  });
  const database = await runtime.getD1Database('DB');
  const table = schema.slice(0, schema.indexOf('CREATE TRIGGER'));
  await database.exec(table.replace(/\n/g, ' '));
  for (const trigger of schema
    .slice(schema.indexOf('CREATE TRIGGER'))
    .split(/(?=CREATE TRIGGER)/)
    .filter(Boolean)) {
    await database.prepare(trigger).run();
  }
  return { runtime, database, values };
}
