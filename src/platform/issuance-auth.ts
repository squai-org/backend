import type { MiddlewareHandler } from 'hono';
import { ApplicationError } from '../shared/errors';
import type { HttpEnvironment } from './bindings';

export const issuanceAuth: MiddlewareHandler<HttpEnvironment> = async (context, next) => {
  if (
    context.env.API_ORIGIN &&
    new URL(context.req.url).origin !== new URL(context.env.API_ORIGIN).origin
  )
    return context.notFound();
  const expected = context.env.CERTIFICATE_ISSUANCE_TOKEN;
  if (!expected || expected.length < 32) throw new ApplicationError('ISSUANCE_UNAVAILABLE');
  const header = context.req.header('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 512)
    throw new ApplicationError('UNAUTHORIZED');
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  const actual = new Uint8Array(actualHash);
  const target = new Uint8Array(expectedHash);
  let mismatch = 0;
  for (let index = 0; index < actual.length; index++)
    mismatch |= (actual[index] ?? 0) ^ (target[index] ?? 0);
  if (mismatch !== 0) throw new ApplicationError('UNAUTHORIZED');
  await next();
};
