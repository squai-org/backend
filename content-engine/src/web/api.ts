export type Status =
  | 'idea'
  | 'produciendo'
  | 'revision'
  | 'ajustes'
  | 'aprobada'
  | 'publicando'
  | 'publicada'
  | 'error';
export type Format = 'post' | 'carrusel' | 'reel' | 'story';
export type Slide = { kicker: string; title: string; body: string };
export type ItemEvent = { id: number; at: string; kind: string; detail: string };
export type Item = {
  id: string;
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  scheduled_at: string | null;
  status: Status;
  copy: string;
  spec: { template: string; slides: Slide[]; script: string } | null;
  assets: string[];
  notes: string;
  iteration: number;
  permalink: string | null;
  error: string | null;
  events?: ItemEvent[];
};
export type Taxonomy = { pillars: string[]; services: string[]; funnel: string[]; ctas: string[] };
export type AppStatus = { instagram: boolean; timezone: string; taxonomy: Taxonomy };
export type Hook = {
  id: string;
  name: string;
  trigger: 'status' | 'weekly';
  status: Status | null;
  weekday: number | null;
  time: string | null;
  action: string;
  agent: string;
  enabled: boolean;
  last_fired: string | null;
};
export type Job = {
  id: string;
  action: string;
  agent: string;
  item_id: string | null;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
  error: string | null;
  created_at: string;
};

export const STATUS_LABEL: Record<Status, string> = {
  idea: 'Idea',
  produciendo: 'Produciendo',
  revision: 'En revisión',
  ajustes: 'Ajustes',
  aprobada: 'Programada',
  publicando: 'Publicando',
  publicada: 'Publicada',
  error: 'Error',
};
export const FORMAT_LABEL: Record<Format, string> = {
  post: 'Post',
  carrusel: 'Carrusel',
  reel: 'Reel',
  story: 'Story',
};

export class Unauthorized extends Error {}

export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (response.status === 401) throw new Unauthorized(data.error ?? 'No autorizado.');
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export async function upload(itemId: string, file: File): Promise<Item> {
  const response = await fetch(
    `/api/items/${itemId}/assets?name=${encodeURIComponent(file.name)}`,
    { method: 'POST', body: file },
  );
  const data = (await response.json()) as Item & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Error ${response.status}`);
  return data;
}

export type InstagramConnection = {
  configured: boolean;
  redirectUri: string;
  connected: boolean;
  username: string | null;
  expiresAt: number | null;
};
