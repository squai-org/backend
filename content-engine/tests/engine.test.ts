import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { type Context, type Executor, nextWeek, parseClaudeOutput } from '../src/server/agents.ts';
import { createApp } from '../src/server/app.ts';
import { loadConfig } from '../src/server/config.ts';
import { createStore } from '../src/server/db.ts';
import { canHumanMove, proposalViolations } from '../src/server/domain.ts';
import { fireWeeklyHooks, localClock, publishDue, workOnce } from '../src/server/pipeline.ts';
import { instagramPublisher, type Publication } from '../src/server/publisher.ts';
import { buildSlideHtml, type RenderJob } from '../src/server/render.ts';
import { createWorkspace } from '../src/server/workspace.ts';

const slide = { kicker: 'Anti-humo', title: 'La IA no piensa por ti', body: 'Genera volumen.' };
const proposal = {
  copy: 'Tesis directa.\n\nLista de espera en el perfil.',
  template: 'editorial.html',
  slides: [slide, { ...slide, title: 'Qué delegar' }],
  script: '',
};

function setup(executor: Executor, env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ce-'));
  const rendered: RenderJob[] = [];
  const published: Publication[] = [];
  const config = loadConfig({
    ADMIN_PASSWORD: 'clave',
    SESSION_SECRET: 'secreto',
    DATA_DIR: dataDir,
    PUBLIC_URL: 'https://ce.test',
    ...env,
  });
  const ctx: Context = {
    config: { ...config, seedDir: resolve('seed') },
    store: createStore(':memory:'),
    workspace: createWorkspace(join(dataDir, 'workspace'), resolve('seed')),
    executor,
    renderer: async (jobs) => {
      rendered.push(...jobs);
    },
    publish: async (_account, publication) => {
      published.push(publication);
      return { id: '1', permalink: 'https://instagram.com/p/x' };
    },
  };
  return { ctx, rendered, published };
}

async function login(app: ReturnType<typeof createApp>): Promise<string> {
  const response = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'clave' }),
  });
  return (response.headers.get('set-cookie') ?? '').split(';')[0];
}

test('transiciones humanas', () => {
  assert.equal(canHumanMove('revision', 'aprobada'), true);
  assert.equal(canHumanMove('revision', 'ajustes'), true);
  assert.equal(canHumanMove('idea', 'aprobada'), false);
  assert.equal(canHumanMove('publicada', 'revision'), false);
});

test('reglas de la propuesta', () => {
  assert.deepEqual(proposalViolations('carrusel', 'Copy 🙂', proposal.slides), []);
  assert.equal(proposalViolations('carrusel', 'Copy 🙂🙂', proposal.slides).length, 1);
  assert.equal(proposalViolations('post', 'Copy', [{ ...slide, title: 'Hola 🚀' }]).length, 1);
  assert.equal(proposalViolations('carrusel', 'Copy', [slide]).length, 1);
  assert.equal(proposalViolations('post', '', [slide]).length, 1);
});

test('html de lámina escapa contenido', () => {
  const html = buildSlideHtml('<b class="{{position}}">{{title}}</b>{{index}}/{{total}}', '', {
    ...slide,
    title: '<script>x</script>',
  }, 0, 3);
  assert.equal(html, '<b class="first">&lt;script&gt;x&lt;/script&gt;</b>1/3');
});

test('salida de claude', () => {
  assert.deepEqual(parseClaudeOutput('{"structured_output":{"a":1},"result":""}'), { a: 1 });
  assert.deepEqual(parseClaudeOutput('{"result":"texto {\\"a\\":2} fin"}'), { a: 2 });
  assert.throws(() => parseClaudeOutput('{"is_error":true,"result":"límite"}'), /límite/);
});

test('semana siguiente y reloj local', () => {
  const wednesday = new Date('2026-11-11T15:00:00Z');
  assert.deepEqual(nextWeek(wednesday, 'America/Bogota'), { from: '2026-11-16', to: '2026-11-22' });
  assert.deepEqual(localClock(new Date('2026-11-16T02:30:00Z'), 'America/Bogota'), {
    date: '2026-11-15',
    weekday: 0,
    time: '21:30',
  });
});

test('idea → propuesta → ajustes → aprobada → publicada', async () => {
  const prompts: string[] = [];
  const { ctx, rendered, published } = setup(
    async ({ prompt }) => {
      prompts.push(prompt);
      return prompt.includes('Anotaciones')
        ? { ...proposal, copy: 'Copy ajustado.', learning: 'Evitar la palabra revolución.' }
        : structuredClone(proposal);
    },
    { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' },
  );
  const app = createApp(ctx);
  const cookie = await login(app);
  const headers = { cookie };

  const created = await app.request('/api/items', {
    method: 'POST',
    headers,
    body: JSON.stringify({ title: 'Mito del reemplazo', format: 'carrusel' }),
  });
  const { id } = (await created.json()) as { id: string };
  assert.equal(await workOnce(ctx), true);
  let item = ctx.store.getItem(id);
  assert.equal(item?.status, 'revision');
  assert.equal(item?.assets.length, 2);
  assert.equal(rendered.length, 2);
  assert.equal(rendered[0].width, 1080);
  assert.match(rendered[0].html, /La IA no piensa por ti/);

  const denied = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'ajustes' }),
  });
  assert.equal(denied.status, 400);

  await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'ajustes', notes: 'Quita revolución.' }),
  });
  assert.equal(await workOnce(ctx), true);
  item = ctx.store.getItem(id);
  assert.equal(item?.status, 'revision');
  assert.equal(item?.copy, 'Copy ajustado.');
  assert.equal(item?.iteration, 2);
  assert.equal(item?.notes, '');
  assert.match(prompts[1], /Quita revolución/);
  assert.match(
    readFileSync(join(ctx.workspace.root, 'bases/aprendizajes.md'), 'utf8'),
    /Evitar la palabra revolución/,
  );

  const unscheduled = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'aprobada' }),
  });
  assert.equal(unscheduled.status, 400);

  const when = new Date(Date.now() - 60000).toISOString();
  const approved = await app.request(`/api/items/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ status: 'aprobada', scheduled_at: when }),
  });
  assert.equal(approved.status, 200);
  await publishDue(ctx);
  item = ctx.store.getItem(id);
  assert.equal(item?.status, 'publicada');
  assert.equal(item?.permalink, 'https://instagram.com/p/x');
  assert.equal(published[0].mediaUrls[0], `https://ce.test/media/${id}/v2-1.jpg`);
});

test('reintenta con las reglas incumplidas y falla a error', async () => {
  const prompts: string[] = [];
  const { ctx } = setup(async ({ prompt }) => {
    prompts.push(prompt);
    return { ...proposal, copy: 'Uno 🙂 dos 🙂' };
  });
  const item = ctx.store.createItem({ title: 'x', format: 'carrusel' });
  ctx.store.enqueue('produce', 'productor', item.id);
  await workOnce(ctx);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /máximo un emoji/);
  const later = new Date(Date.now() + 3600000);
  await workOnce(ctx, later);
  await workOnce(ctx, new Date(later.getTime() + 3600000));
  assert.equal(ctx.store.getItem(item.id)?.status, 'error');
  assert.equal(ctx.store.listJobs()[0].status, 'failed');
});

test('planner crea ideas y encola producción', async () => {
  const { ctx } = setup(async ({ agent }) =>
    agent === 'planner'
      ? {
          items: [
            {
              title: 'Idea 1',
              message: 'm',
              pillar: 'Anti-humo',
              format: 'post',
              service: 'One',
              funnel: 'TOFU',
              cta: 'Lista de espera',
              scheduled_at: '2026-11-17T12:00:00-05:00',
            },
            { title: 'Sin fecha', format: 'post', scheduled_at: 'mañana' },
          ],
        }
      : { ...proposal, slides: [slide] },
  );
  fireWeeklyHooks(ctx, new Date('2026-11-15T23:30:00Z'));
  fireWeeklyHooks(ctx, new Date('2026-11-15T23:40:00Z'));
  assert.equal(ctx.store.listJobs().length, 1);
  await workOnce(ctx);
  const items = ctx.store.listItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].scheduled_at, '2026-11-17T17:00:00.000Z');
  assert.equal(ctx.store.listJobs().filter((job) => job.action === 'produce').length, 1);
});

test('no publica piezas vencidas hace más de un día', async () => {
  const { ctx, published } = setup(async () => proposal, { IG_USER_ID: '1', IG_ACCESS_TOKEN: 't' });
  const item = ctx.store.createItem({
    title: 'x',
    scheduled_at: new Date(Date.now() - 3 * 86400000).toISOString(),
  });
  ctx.store.updateItem(item.id, { status: 'aprobada' });
  await publishDue(ctx);
  assert.equal(published.length, 0);
  assert.equal(ctx.store.getItem(item.id)?.status, 'error');
});

test('api exige sesión y protege rutas de archivos', async () => {
  const { ctx } = setup(async () => proposal);
  const app = createApp(ctx);
  assert.equal((await app.request('/api/items')).status, 401);
  const bad = await app.request('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password: 'otra' }),
  });
  assert.equal(bad.status, 401);
  const headers = { cookie: await login(app) };
  assert.equal((await app.request('/api/files/skills', { headers })).status, 200);
  const traversal = await app.request('/api/files/bases/..%2F..%2Fsecreto.md', { headers });
  assert.equal(traversal.status, 400);
  await app.request('/api/files/skills/nueva', {
    method: 'PUT',
    headers,
    body: JSON.stringify({ content: '# Nueva' }),
  });
  assert.equal(existsSync(join(ctx.workspace.root, '.claude/skills/nueva/SKILL.md')), true);
  writeFileSync(join(ctx.config.dataDir, 'secreto.txt'), 'RESERVADO');
  for (const path of ['/media/%2e%2e/secreto.txt', '/media/..%2fsecreto.txt', '/..%2f..%2fsecreto.txt']) {
    assert.doesNotMatch(await (await app.request(path)).text(), /RESERVADO/);
  }
});

test('publicador de instagram: carrusel', async () => {
  const calls: string[] = [];
  let next = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? String(init.body) : '';
    calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]} ${body}`);
    if (url.includes('status_code')) return Response.json({ status_code: 'FINISHED' });
    if (url.includes('permalink')) return Response.json({ permalink: 'https://instagram.com/p/z' });
    next += 1;
    return Response.json({ id: `c${next}` });
  }) as typeof fetch;
  const publish = instagramPublisher({ fetchImpl, sleep: async () => {} });
  const result = await publish(
    { graphUrl: 'https://graph.test', userId: '99', token: 'tok' },
    { format: 'carrusel', caption: 'Hola', mediaUrls: ['https://a/1.jpg', 'https://a/2.jpg'] },
  );
  assert.deepEqual(result, { id: 'c4', permalink: 'https://instagram.com/p/z' });
  const posts = calls.filter((call) => call.startsWith('POST'));
  assert.equal(posts.length, 4);
  assert.match(posts[0], /is_carousel_item=true/);
  assert.match(posts[2], /media_type=CAROUSEL/);
  assert.match(posts[2], /children=c1%2Cc2/);
  assert.match(posts[3], /media_publish creation_id=c3/);
});

test('publicador de instagram: error de la api', async () => {
  const fetchImpl = (async () =>
    Response.json({ error: { message: 'Token inválido' } }, { status: 400 })) as typeof fetch;
  const publish = instagramPublisher({ fetchImpl, sleep: async () => {} });
  await assert.rejects(
    publish(
      { graphUrl: 'https://graph.test', userId: '99', token: 'tok' },
      { format: 'post', caption: 'Hola', mediaUrls: ['https://a/1.jpg'] },
    ),
    /Token inválido/,
  );
});
