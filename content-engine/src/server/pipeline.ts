import { type Context, runJob } from './agents.ts';
import { CONNECTION_KEY, type InstagramConnection, TOKEN_LIFETIME_MS } from './connections.ts';
import type { Hook } from './db.ts';
import type { Item } from './domain.ts';
import { refreshToken } from './publisher.ts';

const MAX_JOB_ATTEMPTS = 3;
const RETRY_MINUTES = 10;
const STALE_MS = 24 * 60 * 60 * 1000;
const TOKEN_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function dispatchStatusHooks(ctx: Context, item: Item): void {
  for (const hook of ctx.store.listHooks()) {
    if (hook.enabled && hook.trigger === 'status' && hook.status === item.status) {
      ctx.store.enqueue(hook.action, hook.agent, item.id);
    }
  }
}

export async function workOnce(ctx: Context, now = new Date()): Promise<boolean> {
  const job = ctx.store.claimJob(now.toISOString());
  if (!job) return false;
  try {
    const touched = await runJob(ctx, job);
    ctx.store.finishJob(job.id);
    for (const item of touched) dispatchStatusHooks(ctx, item);
  } catch (error) {
    const text = message(error);
    if (job.attempts < MAX_JOB_ATTEMPTS) {
      const runAfter = new Date(now.getTime() + job.attempts * RETRY_MINUTES * 60000);
      ctx.store.retryJob(job.id, text, runAfter.toISOString());
    } else {
      ctx.store.failJob(job.id, text);
      if (job.item_id && ctx.store.getItem(job.item_id)) {
        ctx.store.updateItem(job.item_id, { status: 'error', error: text });
        ctx.store.addEvent(job.item_id, 'error', text);
      }
    }
  }
  return true;
}

export function localClock(now: Date, timezone: string): { date: string; weekday: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday')),
    time: `${get('hour')}:${get('minute')}`,
  };
}

export function fireHook(ctx: Context, hook: Hook): void {
  ctx.store.enqueue(hook.action, hook.agent, null);
}

export function fireWeeklyHooks(ctx: Context, now = new Date()): void {
  const clock = localClock(now, ctx.config.timezone);
  for (const hook of ctx.store.listHooks()) {
    if (!hook.enabled || hook.trigger !== 'weekly' || hook.time === null) continue;
    if (hook.weekday !== clock.weekday || clock.time < hook.time) continue;
    if (hook.last_fired === clock.date) continue;
    ctx.store.updateHook(hook.id, { last_fired: clock.date });
    fireHook(ctx, hook);
  }
}

export function savedConnection(ctx: Context): InstagramConnection | null {
  return ctx.store.getSetting<InstagramConnection | null>(CONNECTION_KEY, null);
}

export function instagramAccount(ctx: Context) {
  const saved = savedConnection(ctx);
  return {
    graphUrl: ctx.config.igGraphUrl,
    userId: saved?.userId ?? ctx.config.igUserId,
    token: saved?.token ?? ctx.config.igAccessToken,
  };
}

export function instagramReady(ctx: Context, now = Date.now()): boolean {
  const saved = savedConnection(ctx);
  if (saved) return saved.expiresAt > now;
  return Boolean(ctx.config.igUserId && ctx.config.igAccessToken);
}

export async function publishDue(ctx: Context, now = new Date()): Promise<void> {
  if (!instagramReady(ctx)) return;
  for (const item of ctx.store.dueItems(now.toISOString())) {
    if (now.getTime() - new Date(item.scheduled_at as string).getTime() > STALE_MS) {
      const text = 'La fecha venció hace más de 24 horas. Reprograma y aprueba de nuevo.';
      ctx.store.updateItem(item.id, { status: 'error', error: text });
      ctx.store.addEvent(item.id, 'error', text);
      continue;
    }
    ctx.store.updateItem(item.id, { status: 'publicando' });
    try {
      const published = await ctx.publish(instagramAccount(ctx), {
        format: item.format,
        caption: item.copy,
        mediaUrls: item.assets.map((asset) => `${ctx.config.publicUrl}/media/${asset}`),
      });
      ctx.store.updateItem(item.id, {
        status: 'publicada',
        permalink: published.permalink,
        error: null,
      });
      ctx.store.addEvent(item.id, 'publicada', published.permalink ?? published.id);
    } catch (error) {
      const text = message(error);
      ctx.store.updateItem(item.id, { status: 'error', error: text });
      ctx.store.addEvent(item.id, 'error', text);
    }
  }
}

export async function refreshInstagramToken(ctx: Context, now = new Date()): Promise<void> {
  const saved = savedConnection(ctx);
  if (!saved || saved.expiresAt <= now.getTime()) return;
  if (now.getTime() - saved.refreshedAt < TOKEN_REFRESH_MS) return;
  try {
    const token = await refreshToken(instagramAccount(ctx));
    ctx.store.setSetting(CONNECTION_KEY, {
      ...saved,
      token,
      refreshedAt: now.getTime(),
      expiresAt: now.getTime() + TOKEN_LIFETIME_MS,
    });
  } catch (error) {
    console.error(message(error));
  }
}

export function startPipeline(ctx: Context): () => void {
  let working = false;
  let ticking = false;
  const worker = setInterval(async () => {
    if (working) return;
    working = true;
    try {
      await workOnce(ctx);
    } finally {
      working = false;
    }
  }, 3000);
  const scheduler = setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      fireWeeklyHooks(ctx);
      await publishDue(ctx);
      await refreshInstagramToken(ctx);
    } catch (error) {
      console.error(message(error));
    } finally {
      ticking = false;
    }
  }, 30000);
  return () => {
    clearInterval(worker);
    clearInterval(scheduler);
  };
}
