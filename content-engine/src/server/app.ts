import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { type Context as Request, Hono } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';
import type { Context } from './agents.ts';
import type { ItemPatch } from './db.ts';
import { ACTIONS, type Action, canHumanMove, isFormat, isStatus } from './domain.ts';
import { dispatchStatusHooks, fireHook, instagramReady } from './pipeline.ts';
import { isKind } from './workspace.ts';

const COOKIE = 'ce_session';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.mp4', '.mov'];
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};
const TEXT_FIELDS = ['title', 'message', 'pillar', 'service', 'funnel', 'cta', 'copy', 'notes'] as const;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function sendFile(c: Request, root: string, relative: string): Response | null {
  const base = resolve(root);
  const path = resolve(base, normalize(relative).replace(/^([/\\])+/, ''));
  if (!path.startsWith(base) || !existsSync(path) || !statSync(path).isFile()) return null;
  return c.body(readFileSync(path), 200, {
    'Content-Type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream',
  });
}

export function createApp(ctx: Context): Hono {
  const { config, store, workspace } = ctx;
  const app = new Hono();
  const secure = config.publicUrl.startsWith('https://');

  app.onError((error, c) => c.json({ error: error.message }, 400));

  app.post('/api/login', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { password?: string };
    await new Promise((done) => setTimeout(done, 300));
    if (!timingSafeEqual(digest(body.password ?? ''), digest(config.adminPassword))) {
      return c.json({ error: 'Contraseña incorrecta.' }, 401);
    }
    await setSignedCookie(c, COOKIE, 'admin', config.sessionSecret, {
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      path: '/',
      maxAge: SESSION_SECONDS,
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  app.use('/api/*', async (c, next) => {
    const session = await getSignedCookie(c, config.sessionSecret, COOKIE);
    if (session !== 'admin') return c.json({ error: 'No autorizado.' }, 401);
    await next();
  });

  app.get('/api/status', (c) =>
    c.json({
      instagram: instagramReady(ctx),
      timezone: config.timezone,
      taxonomy: store.getTaxonomy(),
    }),
  );

  app.put('/api/taxonomy', async (c) => {
    const body = (await c.req.json()) as Record<string, unknown>;
    const clean = (value: unknown) =>
      Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
    const taxonomy = {
      pillars: clean(body.pillars),
      services: clean(body.services),
      funnel: clean(body.funnel),
      ctas: clean(body.ctas),
    };
    store.setSetting('taxonomy', taxonomy);
    return c.json(taxonomy);
  });

  app.get('/api/items', (c) => {
    const status = c.req.query('status');
    return c.json(
      store.listItems({
        from: c.req.query('from'),
        to: c.req.query('to'),
        status: isStatus(status) ? status : undefined,
      }),
    );
  });

  app.post('/api/items', async (c) => {
    const body = (await c.req.json()) as Record<string, string | null>;
    if (!body.title?.trim()) return c.json({ error: 'El título es obligatorio.' }, 400);
    const item = store.createItem({
      title: body.title.trim(),
      message: body.message ?? '',
      pillar: body.pillar ?? '',
      format: isFormat(body.format) ? body.format : 'post',
      service: body.service ?? '',
      funnel: body.funnel ?? '',
      cta: body.cta ?? '',
      scheduled_at: body.scheduled_at ?? null,
    });
    dispatchStatusHooks(ctx, item);
    return c.json(item, 201);
  });

  app.get('/api/items/:id', (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    return c.json({ ...item, events: store.listEvents(item.id) });
  });

  app.patch('/api/items/:id', async (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: ItemPatch = {};
    for (const field of TEXT_FIELDS) {
      if (typeof body[field] === 'string') patch[field] = body[field] as string;
    }
    if (isFormat(body.format)) patch.format = body.format;
    if (body.scheduled_at === null) patch.scheduled_at = null;
    if (typeof body.scheduled_at === 'string') {
      const date = new Date(body.scheduled_at);
      if (Number.isNaN(date.getTime())) return c.json({ error: 'Fecha inválida.' }, 400);
      patch.scheduled_at = date.toISOString();
    }
    const moved = isStatus(body.status) && body.status !== item.status ? body.status : null;
    if (moved) {
      if (!canHumanMove(item.status, moved)) {
        return c.json({ error: `No se puede pasar de ${item.status} a ${moved}.` }, 409);
      }
      const notes = patch.notes ?? item.notes;
      if (moved === 'ajustes' && !notes.trim()) {
        return c.json({ error: 'Escribe las anotaciones antes de pedir ajustes.' }, 400);
      }
      const scheduled = 'scheduled_at' in patch ? patch.scheduled_at : item.scheduled_at;
      if (moved === 'aprobada' && !scheduled) {
        return c.json({ error: 'Define fecha y hora antes de aprobar.' }, 400);
      }
      patch.status = moved;
      patch.error = null;
    }
    const updated = store.updateItem(item.id, patch);
    if (moved) {
      store.addEvent(item.id, 'estado', `${item.status} → ${moved}`);
      dispatchStatusHooks(ctx, updated);
    }
    return c.json(updated);
  });

  app.delete('/api/items/:id', (c) => {
    store.deleteItem(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.post('/api/items/:id/assets', async (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    const extension = extname(c.req.query('name') ?? '').toLowerCase();
    if (!UPLOAD_EXTENSIONS.includes(extension)) {
      return c.json({ error: `Formatos permitidos: ${UPLOAD_EXTENSIONS.join(', ')}.` }, 400);
    }
    const asset = `${item.id}/upload-${Date.now()}${extension}`;
    const path = join(config.dataDir, 'media', asset);
    mkdirSync(join(config.dataDir, 'media', item.id), { recursive: true });
    writeFileSync(path, Buffer.from(await c.req.arrayBuffer()));
    const assets = c.req.query('mode') === 'append' ? [...item.assets, asset] : [asset];
    store.addEvent(item.id, 'archivo', asset);
    return c.json(store.updateItem(item.id, { assets }));
  });

  app.get('/api/files/:kind', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    return c.json(workspace.list(kind));
  });

  app.get('/api/files/:kind/:name', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    const content = workspace.read(kind, c.req.param('name'));
    if (content === null) return c.json({ error: 'No existe.' }, 404);
    return c.json({ name: c.req.param('name'), content });
  });

  app.put('/api/files/:kind/:name', async (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    const body = (await c.req.json()) as { content?: string };
    workspace.write(kind, c.req.param('name'), body.content ?? '');
    return c.json({ ok: true });
  });

  app.delete('/api/files/:kind/:name', (c) => {
    const kind = c.req.param('kind');
    if (!isKind(kind)) return c.json({ error: 'Tipo inválido.' }, 404);
    workspace.remove(kind, c.req.param('name'));
    return c.json({ ok: true });
  });

  app.get('/api/hooks', (c) => c.json(store.listHooks()));

  app.patch('/api/hooks/:id', async (c) => {
    const hook = store.getHook(c.req.param('id'));
    if (!hook) return c.json({ error: 'No existe.' }, 404);
    const body = (await c.req.json()) as Record<string, unknown>;
    const patch: Parameters<typeof store.updateHook>[1] = {};
    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.agent === 'string' && workspace.list('agents').includes(`${body.agent}.md`)) {
      patch.agent = body.agent;
    }
    if (typeof body.weekday === 'number' && body.weekday >= 0 && body.weekday <= 6) {
      patch.weekday = body.weekday;
    }
    if (typeof body.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
      patch.time = body.time;
    }
    store.updateHook(hook.id, patch);
    return c.json(store.getHook(hook.id));
  });

  app.post('/api/hooks/:id/fire', (c) => {
    const hook = store.getHook(c.req.param('id'));
    if (!hook || hook.trigger !== 'weekly') return c.json({ error: 'No existe.' }, 404);
    fireHook(ctx, hook);
    return c.json({ ok: true });
  });

  app.post('/api/items/:id/run', async (c) => {
    const item = store.getItem(c.req.param('id'));
    if (!item) return c.json({ error: 'No existe.' }, 404);
    const body = (await c.req.json()) as { action?: Action };
    const action = body.action;
    if (!action || !ACTIONS.includes(action) || action === 'plan') {
      return c.json({ error: 'Acción inválida.' }, 400);
    }
    const hook = store.listHooks().find((entry) => entry.action === action);
    if (!hook) return c.json({ error: 'Sin agente para la acción.' }, 400);
    store.enqueue(action, hook.agent, item.id);
    return c.json({ ok: true });
  });

  app.get('/api/jobs', (c) => c.json(store.listJobs()));

  app.get('/media/*', (c) => {
    const response = sendFile(c, join(config.dataDir, 'media'), c.req.path.slice('/media/'.length));
    return response ?? c.notFound();
  });

  app.get('*', (c) => {
    const response =
      sendFile(c, config.webDir, c.req.path === '/' ? 'index.html' : c.req.path) ??
      sendFile(c, config.webDir, 'index.html');
    return response ?? c.text('Ejecuta npm run build.', 503);
  });

  return app;
}
