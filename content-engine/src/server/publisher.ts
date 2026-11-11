import type { Format } from './domain.ts';

export type InstagramAccount = { graphUrl: string; userId: string; token: string };
export type Publication = { format: Format; caption: string; mediaUrls: string[] };
export type Published = { id: string; permalink: string | null };
export type Publish = (account: InstagramAccount, publication: Publication) => Promise<Published>;

type Options = { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; maxPolls?: number };

const POLL_MS = 5000;

function isVideo(url: string): boolean {
  return /\.(mp4|mov)$/i.test(url);
}

export function instagramPublisher(options: Options = {}): Publish {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  const maxPolls = options.maxPolls ?? 60;

  async function call(
    account: InstagramAccount,
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string>,
  ): Promise<Record<string, string>> {
    const query = new URLSearchParams({ ...params, access_token: account.token });
    const url = `${account.graphUrl}/${path}`;
    const response =
      method === 'GET'
        ? await fetchImpl(`${url}?${query}`)
        : await fetchImpl(url, { method, body: query });
    const body = (await response.json()) as Record<string, unknown>;
    if (!response.ok || body.error) {
      const error = body.error as { message?: string } | undefined;
      throw new Error(`Instagram: ${error?.message ?? response.status}`);
    }
    return body as Record<string, string>;
  }

  async function container(
    account: InstagramAccount,
    params: Record<string, string>,
  ): Promise<string> {
    const created = await call(account, 'POST', `${account.userId}/media`, params);
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const state = await call(account, 'GET', created.id, { fields: 'status_code' });
      if (state.status_code === 'FINISHED') return created.id;
      if (state.status_code === 'ERROR' || state.status_code === 'EXPIRED') {
        throw new Error(`Instagram: contenedor ${state.status_code}`);
      }
      await sleep(POLL_MS);
    }
    throw new Error('Instagram: el contenedor no terminó de procesarse.');
  }

  function mediaParams(url: string): Record<string, string> {
    return isVideo(url) ? { video_url: url } : { image_url: url };
  }

  return async (account, publication) => {
    const [first] = publication.mediaUrls;
    if (!first) throw new Error('La pieza no tiene archivos para publicar.');
    let creationId: string;
    if (publication.format === 'carrusel') {
      const children: string[] = [];
      for (const url of publication.mediaUrls) {
        const child = { ...mediaParams(url), is_carousel_item: 'true' };
        children.push(
          await container(account, isVideo(url) ? { ...child, media_type: 'VIDEO' } : child),
        );
      }
      creationId = await container(account, {
        media_type: 'CAROUSEL',
        children: children.join(','),
        caption: publication.caption,
      });
    } else if (publication.format === 'story') {
      creationId = await container(account, { ...mediaParams(first), media_type: 'STORIES' });
    } else if (publication.format === 'reel') {
      if (!isVideo(first)) throw new Error('Un reel necesita un archivo de video.');
      creationId = await container(account, {
        media_type: 'REELS',
        video_url: first,
        caption: publication.caption,
      });
    } else {
      creationId = await container(account, { image_url: first, caption: publication.caption });
    }
    const published = await call(account, 'POST', `${account.userId}/media_publish`, {
      creation_id: creationId,
    });
    const details = await call(account, 'GET', published.id, { fields: 'permalink' }).catch(
      () => ({}) as Record<string, string>,
    );
    return { id: published.id, permalink: details.permalink ?? null };
  };
}

export async function refreshToken(
  account: InstagramAccount,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const query = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: account.token });
  const response = await fetchImpl(`${account.graphUrl}/refresh_access_token?${query}`);
  const body = (await response.json()) as { access_token?: string; error?: { message?: string } };
  if (!response.ok || !body.access_token) {
    throw new Error(`Instagram: ${body.error?.message ?? response.status}`);
  }
  return body.access_token;
}
