import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { certificateRoutes } from './modules/certificates/presentation/routes';
import type { HttpEnvironment } from './platform/bindings';
import { errorStatus } from './platform/error-status';
import { ApplicationError } from './shared/errors';

export const app = new Hono<HttpEnvironment>();

app.use('*', async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set('requestId', requestId);
  await next();
  context.header('X-Request-Id', requestId);
  context.header('X-Content-Type-Options', 'nosniff');
  context.header('X-Frame-Options', 'DENY');
  context.header('Referrer-Policy', 'no-referrer');
  context.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
  context.header('Cache-Control', 'no-store');
  context.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  context.header(
    'Content-Security-Policy',
    "default-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
});

app.get('/health', (context) => context.json({ status: 'ok' }));
app.get('/certificate-assets/*', (context) => context.env.ASSETS.fetch(context.req.raw));
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
