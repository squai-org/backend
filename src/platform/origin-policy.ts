import type { MiddlewareHandler } from 'hono';
import type { HttpEnvironment } from './bindings';

export const originPolicy: MiddlewareHandler<HttpEnvironment> = async (context, next) => {
  const apiOrigin = context.env.API_ORIGIN;
  if (!apiOrigin) return next();
  const url = new URL(context.req.url);
  const publicOrigin = context.env.PUBLIC_ORIGIN;
  const isApiPath =
    url.pathname === '/health' ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/.well-known/jwks.json';
  if (url.origin === publicOrigin && url.pathname === '/.well-known/jwks.json')
    return context.redirect(`${apiOrigin}${url.pathname}${url.search}`, 308);
  if (url.origin === apiOrigin && isApiPath) return next();
  if (url.origin === publicOrigin && !isApiPath) return next();
  if (url.origin === apiOrigin && url.pathname.startsWith('/verify/'))
    return context.redirect(`${publicOrigin}${url.pathname}${url.search}`, 308);
  return context.json({ error: { code: 'NOT_FOUND', requestId: context.get('requestId') } }, 404);
};
