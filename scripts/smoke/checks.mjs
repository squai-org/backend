const apiOrigin = 'https://api.squai.io';
const publicOrigin = 'https://www.verify.squai.io';
const missingHash = '0'.repeat(64);

function contentType(response) {
  return response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() ?? '';
}

async function jsonContract(response, validate) {
  if (contentType(response) !== 'application/json') return 'CONTENT_TYPE';
  try {
    return validate(await response.json()) ? null : 'INVALID_BODY';
  } catch (error) {
    if (error instanceof SyntaxError) return 'INVALID_BODY';
    throw error;
  }
}

function errorContract(code) {
  return (response) => jsonContract(response, (body) => body?.error?.code === code);
}

async function assetContract(response, types, magic) {
  if (!types.includes(contentType(response))) return 'CONTENT_TYPE';
  if (!response.body) return 'EMPTY_BODY';
  const reader = response.body.getReader();
  try {
    const bytes = new Uint8Array(256);
    let length = 0;
    while (length < bytes.length) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, bytes.length - length);
      bytes.set(chunk, length);
      length += chunk.length;
    }
    if (!length) return 'EMPTY_BODY';
    const prefix = new TextDecoder().decode(bytes.subarray(0, length)).trimStart();
    if (/^<!doctype\s+html|^<html/i.test(prefix)) return 'INVALID_BODY';
    return magic && !magic.test(prefix) ? 'INVALID_BODY' : null;
  } finally {
    await reader.cancel();
  }
}

export function productionChecks(api = apiOrigin, frontend = publicOrigin) {
  const check = (id, url, expectedStatus, validate, extra = {}) => ({
    id,
    url,
    expectedStatus,
    validate,
    method: 'GET',
    ...extra,
  });
  return [
    check(
      'api_health',
      `${api}/health`,
      200,
      (response) => jsonContract(response, (body) => body?.status === 'ok'),
      { readiness: true },
    ),
    check('public_keys', `${api}/.well-known/jwks.json`, 200, (response) =>
      jsonContract(
        response,
        (body) =>
          Array.isArray(body?.keys) &&
          body.keys.length > 0 &&
          body.keys.every(
            (key) =>
              key?.kty === 'OKP' &&
              key.crv === 'Ed25519' &&
              typeof key.x === 'string' &&
              !Object.hasOwn(key, 'd'),
          ),
      ),
    ),
    check(
      'missing_certificate',
      `${api}/api/v1/certificates/${missingHash}`,
      404,
      errorContract('CERTIFICATE_NOT_FOUND'),
    ),
    check(
      'issuance_authentication',
      `${api}/api/v1/certificates`,
      401,
      errorContract('UNAUTHORIZED'),
      { method: 'POST' },
    ),
    ...['/health', '/api/v1/certificates', `/api/v1/certificates/${missingHash}`].map(
      (path, index) =>
        check(
          `frontend_api_boundary_${index + 1}`,
          `${frontend}${path}`,
          404,
          errorContract('NOT_FOUND'),
        ),
    ),
    check('historical_key_redirect', `${frontend}/.well-known/jwks.json`, 308, async (response) =>
      response.headers.get('Location') === `${api}/.well-known/jwks.json`
        ? null
        : 'REDIRECT_LOCATION',
    ),
    check(
      'missing_pdf',
      `${api}/api/v1/certificates/${missingHash}/pdf`,
      404,
      errorContract('CERTIFICATE_NOT_FOUND'),
    ),
    ...[
      [
        'viewer_script',
        '/certificate-viewer/viewer.js',
        ['text/javascript', 'application/javascript'],
      ],
      ['viewer_styles', '/certificate-viewer/viewer.css', ['text/css']],
      [
        'pdf_worker',
        '/certificate-viewer/pdf.worker.js',
        ['text/javascript', 'application/javascript'],
      ],
      ['brand_mark', '/brand/mark.svg', ['image/svg+xml'], /^<svg\b/],
      ['familjen_font', '/brand/familjen-grotesk-latin.woff2', ['font/woff2'], /^wOF2/],
      ['atkinson_font', '/brand/atkinson-hyperlegible-next-latin.woff2', ['font/woff2'], /^wOF2/],
      ['gloria_font', '/brand/gloria-hallelujah-latin.woff2', ['font/woff2'], /^wOF2/],
    ].map(([id, path, types, magic]) =>
      check(id, `${frontend}${path}`, 200, (response) => assetContract(response, types, magic), {
        retryMissingAsset: true,
      }),
    ),
  ];
}
