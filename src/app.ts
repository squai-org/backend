import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { certificateRoutes } from './modules/certificates/presentation/routes';
import type { HttpEnvironment } from './platform/bindings';
import { buildVersion } from './platform/build-version';
import { errorStatus } from './platform/error-status';
import { originPolicy } from './platform/origin-policy';
import { ApplicationError } from './shared/errors';

export const app = new Hono<HttpEnvironment>();

app.use('*', async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set('requestId', requestId);
  await next();
  context.header('X-Request-Id', requestId);
  context.header('X-Deployment-Version', buildVersion);
  context.header('X-Content-Type-Options', 'nosniff');
  const isViewer = context.req.path.startsWith('/verify/') && context.res.status === 200;
  const apiOrigin = context.env.API_ORIGIN ?? '';
  context.header('X-Frame-Options', 'DENY');
  context.header('Referrer-Policy', 'no-referrer');
  context.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  context.header('Cache-Control', 'no-store');
  context.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  context.header(
    'Content-Security-Policy',
    isViewer
      ? `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self' ${apiOrigin}; img-src 'self' blob: data:; font-src 'self' blob:; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
      : "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
});

app.use('*', originPolicy);
app.use(
  '*',
  cors({
    origin: (origin, context) => (origin === context.env.PUBLIC_ORIGIN ? origin : undefined),
    allowMethods: ['GET', 'HEAD'],
    allowHeaders: ['Content-Type', 'Range'],
    exposeHeaders: ['Content-Disposition'],
  }),
);

app.get('/health', (context) => context.json({ status: 'ok' }));
app.get('/certificate-assets/*', (context) => context.env.ASSETS.fetch(context.req.raw));
app.get('/certificate-viewer/*', (context) => context.env.ASSETS.fetch(context.req.raw));
app.get('/brand/*', (context) => context.env.ASSETS.fetch(context.req.raw));
app.route('/', certificateRoutes);
app.notFound((context) =>
  context.json({ error: { code: 'NOT_FOUND', requestId: context.get('requestId') } }, 404),
);
app.onError((error, context) => {
  if (error instanceof ApplicationError) {
    const status = errorStatus[error.code];
    if (status === 401) context.header('WWW-Authenticate', 'Bearer');
    return context.json(
      { error: { code: error.code, requestId: context.get('requestId') } },
      status,
    );
  }
  if (error instanceof HTTPException)
    return context.json(
      { error: { code: 'REQUEST_REJECTED', requestId: context.get('requestId') } },
      error.status,
    );
  console.error(
    JSON.stringify({
      event: 'request_failed',
      requestId: context.get('requestId'),
      errorType: error.name,
    }),
  );
  return context.json(
    { error: { code: 'INTERNAL_ERROR', requestId: context.get('requestId') } },
    500,
  );
});
