import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { Config } from './config.ts';
import type { Job, Store } from './db.ts';
import { FORMATS, type Item, isFormat, proposalViolations, type Slide } from './domain.ts';
import type { Publish } from './publisher.ts';
import { buildSlideHtml, type Renderer } from './render.ts';
import type { Workspace } from './workspace.ts';

export type ExecutorInput = { agent: string; prompt: string; schema: object; cwd: string };
export type Executor = (input: ExecutorInput) => Promise<unknown>;

export type Context = {
  config: Config;
  store: Store;
  workspace: Workspace;
  executor: Executor;
  renderer: Renderer;
  publish: Publish;
};

const TOOLS = ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'Skill'];
const TIMEOUT_MS = 20 * 60 * 1000;
const MAX_ATTEMPTS = 2;

const SLIDES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      kicker: { type: 'string' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['kicker', 'title', 'body'],
    additionalProperties: false,
  },
};

const PROPOSAL_PROPERTIES = {
  copy: { type: 'string' },
  template: { type: 'string' },
  slides: SLIDES_SCHEMA,
  script: { type: 'string' },
};

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: PROPOSAL_PROPERTIES,
  required: ['copy', 'template', 'slides', 'script'],
  additionalProperties: false,
};

const REVISION_SCHEMA = {
  type: 'object',
  properties: { ...PROPOSAL_PROPERTIES, learning: { type: 'string' } },
  required: ['copy', 'template', 'slides', 'script', 'learning'],
  additionalProperties: false,
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          message: { type: 'string' },
          pillar: { type: 'string' },
          format: { type: 'string', enum: [...FORMATS] },
          service: { type: 'string' },
          funnel: { type: 'string' },
          cta: { type: 'string' },
          scheduled_at: { type: 'string' },
        },
        required: [
          'title',
          'message',
          'pillar',
          'format',
          'service',
          'funnel',
          'cta',
          'scheduled_at',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

type Proposal = { copy: string; template: string; slides: Slide[]; script: string };
type Revision = Proposal & { learning: string };
type Plan = { items: Record<string, string>[] };

export function claudeExecutor(bin: string): Executor {
  return ({ agent, prompt, schema, cwd }) =>
    new Promise((resolve, reject) => {
      const contract = [
        prompt,
        'Responde únicamente con un objeto JSON válido, sin texto adicional, que cumpla este JSON Schema:',
        JSON.stringify(schema),
      ].join('\n\n');
      const args = [
        '-p',
        contract,
        '--agent',
        agent,
        '--output-format',
        'json',
        '--allowedTools',
        ...TOOLS,
      ];
      execFile(
        bin,
        args,
        { cwd, timeout: TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && !stdout) {
            reject(new Error(stderr.trim() || error.message));
            return;
          }
          try {
            resolve(parseClaudeOutput(stdout));
          } catch (parseError) {
            reject(parseError);
          }
        },
      );
    });
}

export function parseClaudeOutput(stdout: string): unknown {
  const output = JSON.parse(stdout) as {
    is_error?: boolean;
    result?: string;
    structured_output?: unknown;
  };
  if (output.is_error) throw new Error(output.result ?? 'Claude devolvió un error.');
  if (output.structured_output !== undefined) return output.structured_output;
  const text = output.result ?? '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('Claude no devolvió JSON.');
  return JSON.parse(text.slice(start, end + 1));
}

function itemBrief(item: Item): string {
  return JSON.stringify(
    {
      titulo: item.title,
      mensaje: item.message,
      pilar: item.pillar,
      formato: item.format,
      servicio: item.service,
      etapa: item.funnel,
      cta: item.cta,
      fecha: item.scheduled_at,
    },
    null,
    2,
  );
}

function templatesBrief(ctx: Context, item: Item): string {
  const names = ctx.workspace.templatesFor(item.format).map((template) => template.name);
  return names.length ? names.join(', ') : 'ninguno';
}

function producePrompt(ctx: Context, item: Item): string {
  return [
    'Crea la propuesta de esta pieza de Instagram.',
    'Lee todo bases/ antes de escribir. Aplica las skills copy-instagram y diseno-pieza.',
    `Pieza:\n${itemBrief(item)}`,
    `Templates disponibles en templates/ para este formato: ${templatesBrief(ctx, item)}.`,
    'Si el formato es reel, deja slides vacío y escribe el guion en script. En otro caso deja script vacío.',
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

function revisePrompt(ctx: Context, item: Item): string {
  return [
    'Aplica las anotaciones del revisor humano a esta pieza de Instagram.',
    'Lee todo bases/ antes de escribir. Aplica la skill revision-ajustes.',
    `Pieza:\n${itemBrief(item)}`,
    `Propuesta actual:\n${JSON.stringify({ copy: item.copy, ...item.spec }, null, 2)}`,
    `Anotaciones:\n${item.notes}`,
    `Templates disponibles en templates/ para este formato: ${templatesBrief(ctx, item)}.`,
    'Cambia solo lo que piden las anotaciones. En learning resume en una frase la regla general que se aprende, o deja vacío si no hay.',
    'Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

export function nextWeek(now: Date, timezone: string): { from: string; to: string } {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(
    now,
  );
  const index = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const untilMonday = ((8 - index) % 7) || 7;
  const day = (offset: number) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(
      new Date(now.getTime() + offset * 86400000),
    );
  return { from: day(untilMonday), to: day(untilMonday + 6) };
}

function planPrompt(ctx: Context, from: string, to: string): string {
  const taxonomy = ctx.store.getTaxonomy();
  const scheduled = ctx.store
    .listItems({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` })
    .filter((item) => item.scheduled_at)
    .map((item) => `${item.scheduled_at} · ${item.format} · ${item.title}`);
  return [
    `Planifica la parrilla de Instagram del ${from} al ${to}. Zona horaria: ${ctx.config.timezone}.`,
    'Lee todo bases/ antes de planificar. Aplica la skill estrategia-parrilla.',
    `Pilares: ${taxonomy.pillars.join(', ')}.`,
    `Servicios: ${taxonomy.services.join(', ')}.`,
    `Etapas del embudo: ${taxonomy.funnel.join(', ')}.`,
    `Llamadas a la acción: ${taxonomy.ctas.join(', ')}.`,
    `Formatos: ${FORMATS.join(', ')}.`,
    `Ya programado en ese rango:\n${scheduled.join('\n') || 'nada'}`,
    `Títulos recientes que no se repiten:\n${ctx.store.recentTitles(40).join('\n') || 'ninguno'}`,
    'scheduled_at va en ISO 8601 con offset de la zona horaria. Devuelve solo el JSON pedido.',
  ].join('\n\n');
}

function normalizeSlides(item: Item, slides: Slide[]): Slide[] {
  if (item.format === 'reel') return [];
  return slides.map((slide) => ({
    kicker: slide.kicker ?? '',
    title: slide.title ?? '',
    body: slide.body ?? '',
  }));
}

async function propose<T extends Proposal>(
  ctx: Context,
  job: Job,
  item: Item,
  prompt: string,
  schema: object,
): Promise<T> {
  let feedback = '';
  let problems: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const output = (await ctx.executor({
      agent: job.agent,
      prompt: prompt + feedback,
      schema,
      cwd: ctx.workspace.root,
    })) as T;
    output.slides = normalizeSlides(item, output.slides ?? []);
    problems =
      item.format === 'reel'
        ? proposalViolations('reel', output.copy ?? '', []).concat(
            output.script?.trim() ? [] : ['El reel necesita guion.'],
          )
        : proposalViolations(item.format, output.copy ?? '', output.slides);
    if (!problems.length) return output;
    feedback = `\n\nTu respuesta anterior incumplió estas reglas, corrígelas:\n- ${problems.join('\n- ')}`;
  }
  throw new Error(`La propuesta incumple reglas: ${problems.join(' ')}`);
}

async function applyProposal(ctx: Context, item: Item, proposal: Proposal): Promise<Item> {
  const iteration = item.iteration + 1;
  let assets = item.assets;
  let templateName = '';
  if (proposal.slides.length) {
    const template = ctx.workspace.pickTemplate(proposal.template, item.format);
    const html = ctx.workspace.read('templates', template.name) as string;
    const tokens = ctx.workspace.tokens();
    templateName = template.name;
    assets = proposal.slides.map((_, index) => `${item.id}/v${iteration}-${index + 1}.jpg`);
    await ctx.renderer(
      proposal.slides.map((slide, index) => ({
        html: buildSlideHtml(html, tokens, slide, index, proposal.slides.length),
        width: template.width,
        height: template.height,
        path: join(ctx.config.dataDir, 'media', assets[index]),
      })),
    );
  }
  return ctx.store.updateItem(item.id, {
    copy: proposal.copy,
    spec: { template: templateName, slides: proposal.slides, script: proposal.script ?? '' },
    assets,
    iteration,
    status: 'revision',
    error: null,
  });
}

function requireItem(ctx: Context, job: Job): Item {
  const item = job.item_id ? ctx.store.getItem(job.item_id) : null;
  if (!item) throw new Error('La pieza ya no existe.');
  return item;
}

async function produce(ctx: Context, job: Job): Promise<Item[]> {
  const item = requireItem(ctx, job);
  if (item.status !== 'idea' && item.status !== 'produciendo') return [];
  ctx.store.updateItem(item.id, { status: 'produciendo' });
  const proposal = await propose<Proposal>(ctx, job, item, producePrompt(ctx, item), PROPOSAL_SCHEMA);
  const updated = await applyProposal(ctx, item, proposal);
  ctx.store.addEvent(item.id, 'propuesta', `Versión ${updated.iteration}`);
  return [updated];
}

async function revise(ctx: Context, job: Job): Promise<Item[]> {
  const item = requireItem(ctx, job);
  if (item.status !== 'ajustes') return [];
  const revision = await propose<Revision>(ctx, job, item, revisePrompt(ctx, item), REVISION_SCHEMA);
  const updated = await applyProposal(ctx, item, revision);
  ctx.store.addEvent(item.id, 'ajustes', item.notes);
  ctx.store.updateItem(item.id, { notes: '' });
  if (revision.learning?.trim()) ctx.workspace.appendLearning(revision.learning);
  return [{ ...updated, notes: '' }];
}

async function plan(ctx: Context, job: Job): Promise<Item[]> {
  const { from, to } = nextWeek(new Date(), ctx.config.timezone);
  const output = (await ctx.executor({
    agent: job.agent,
    prompt: planPrompt(ctx, from, to),
    schema: PLAN_SCHEMA,
    cwd: ctx.workspace.root,
  })) as Plan;
  const created: Item[] = [];
  for (const idea of output.items ?? []) {
    const date = new Date(idea.scheduled_at);
    if (!idea.title?.trim() || !isFormat(idea.format) || Number.isNaN(date.getTime())) continue;
    created.push(
      ctx.store.createItem({
        title: idea.title.trim(),
        message: idea.message,
        pillar: idea.pillar,
        format: idea.format,
        service: idea.service,
        funnel: idea.funnel,
        cta: idea.cta,
        scheduled_at: date.toISOString(),
      }),
    );
  }
  if (!created.length) throw new Error('El planner no devolvió ideas válidas.');
  return created;
}

export async function runJob(ctx: Context, job: Job): Promise<Item[]> {
  if (job.action === 'plan') return plan(ctx, job);
  if (job.action === 'produce') return produce(ctx, job);
  return revise(ctx, job);
}
