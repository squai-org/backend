import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { HttpEnvironment } from '../../../platform/bindings';
import { issuanceAuth } from '../../../platform/issuance-auth';
import { ApplicationError } from '../../../shared/errors';
import { certificatesModule } from '../module';
import { renderCertificate } from './render-certificate';

export const certificateRoutes = new Hono<HttpEnvironment>();

certificateRoutes.post(
  '/api/v1/certificates',
  issuanceAuth,
  bodyLimit({
    maxSize: 8192,
    onError: () => {
      throw new ApplicationError('PAYLOAD_TOO_LARGE');
    },
  }),
  async (context) => {
    if (
      context.req.header('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
    )
      throw new ApplicationError('UNSUPPORTED_MEDIA_TYPE');
    let input: unknown;
    try {
      input = await context.req.json();
    } catch {
      throw new ApplicationError('INVALID_JSON');
    }
    const { certificate, created } = await certificatesModule(context.env).issue.execute(input);
    if (created) context.header('Location', certificate.verificationUrl);
    return context.json(
      {
        hash: certificate.record.hash,
        verificationUrl: certificate.verificationUrl,
        templateId: certificate.record.payload.templateId,
        signature: certificate.record.signature,
        keyId: certificate.record.keyId,
        credential: certificate.credential,
        credentialJwt: certificate.record.credentialJwt,
      },
      created ? 201 : 200,
    );
  },
);

certificateRoutes.get('/verify/:hash', async (context) => {
  const certificate = await certificatesModule(context.env).verify.execute(
    context.req.param('hash'),
  );
  return context.html(renderCertificate(certificate));
});

certificateRoutes.get('/api/v1/certificates/:hash', async (context) => {
  const certificate = await certificatesModule(context.env).verify.execute(
    context.req.param('hash'),
  );
  return context.json({
    valid: true,
    verificationUrl: certificate.verificationUrl,
    credential: certificate.credential,
    credentialJwt: certificate.record.credentialJwt,
  });
});

certificateRoutes.get('/api/v1/certificates/:hash/credential', async (context) => {
  const certificate = await certificatesModule(context.env).verify.execute(
    context.req.param('hash'),
  );
  return context.body(certificate.record.credentialJwt, 200, {
    'Content-Type': 'application/vc+jwt',
  });
});

certificateRoutes.get('/.well-known/jwks.json', (context) =>
  context.json(certificatesModule(context.env).jwks),
);
