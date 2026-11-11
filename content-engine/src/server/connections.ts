import type { Config } from './config.ts';

export type InstagramConnection = {
  userId: string;
  username: string;
  token: string;
  expiresAt: number;
  refreshedAt: number;
};

export const CONNECTION_KEY = 'instagram';
export const TOKEN_LIFETIME_MS = 60 * 24 * 60 * 60 * 1000;

const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];

type Payload = Record<string, unknown>;

export function callbackUrl(config: Config): string {
  return `${config.publicUrl}/api/connections/instagram/callback`;
}

export function appConfigured(config: Config): boolean {
  return Boolean(config.igAppId && config.igAppSecret);
}

export function authorizeUrl(config: Config, state: string): string {
  const query = new URLSearchParams({
    client_id: config.igAppId,
    redirect_uri: callbackUrl(config),
    response_type: 'code',
    scope: SCOPES.join(','),
    state,
  });
  return `${config.igAuthUrl}?${query}`;
}

async function readPayload(response: Response): Promise<Payload> {
  const body = (await response.json().catch(() => ({}))) as Payload;
  if (!response.ok || body.error || body.error_message) {
    const error = body.error as { message?: string } | string | undefined;
    const text =
      (body.error_message as string | undefined) ??
      (typeof error === 'string' ? error : error?.message) ??
      `HTTP ${response.status}`;
    throw new Error(`Instagram: ${text}`);
  }
  return body;
}

export async function completeConnection(
  config: Config,
  rawCode: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<InstagramConnection> {
  const code = rawCode.replace(/#_$/, '');
  const short = await readPayload(
    await fetchImpl(config.igTokenUrl, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: config.igAppId,
        client_secret: config.igAppSecret,
        grant_type: 'authorization_code',
        redirect_uri: callbackUrl(config),
        code,
      }),
    }),
  );
  const exchange = new URLSearchParams({
    grant_type: 'ig_exchange_token',
    client_secret: config.igAppSecret,
    access_token: String(short.access_token ?? ''),
  });
  const long = await readPayload(await fetchImpl(`${config.igGraphUrl}/access_token?${exchange}`));
  const token = String(long.access_token ?? '');
  if (!token) throw new Error('Instagram: no entregó un token de larga duración.');
  const profile = await readPayload(
    await fetchImpl(
      `${config.igGraphUrl}/me?${new URLSearchParams({ fields: 'user_id,username', access_token: token })}`,
    ),
  );
  const userId = String(profile.user_id ?? short.user_id ?? '');
  if (!userId) throw new Error('Instagram: no entregó el id de la cuenta.');
  const lifetime = Number(long.expires_in) * 1000 || TOKEN_LIFETIME_MS;
  return {
    userId,
    username: String(profile.username ?? ''),
    token,
    expiresAt: now + lifetime,
    refreshedAt: now,
  };
}
