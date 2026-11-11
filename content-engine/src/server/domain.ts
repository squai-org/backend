export const STATUSES = [
  'idea',
  'produciendo',
  'revision',
  'ajustes',
  'aprobada',
  'publicando',
  'publicada',
  'error',
] as const;
export type Status = (typeof STATUSES)[number];

export const FORMATS = ['post', 'carrusel', 'reel', 'story'] as const;
export type Format = (typeof FORMATS)[number];

export const ACTIONS = ['plan', 'produce', 'revise'] as const;
export type Action = (typeof ACTIONS)[number];

export type Slide = { kicker: string; title: string; body: string };
export type Spec = { template: string; slides: Slide[]; script: string };

export type Item = {
  id: string;
  title: string;
  message: string;
  pillar: string;
  format: Format;
  service: string;
  funnel: string;
  cta: string;
  network: string;
  scheduled_at: string | null;
  status: Status;
  copy: string;
  spec: Spec | null;
  assets: string[];
  notes: string;
  iteration: number;
  permalink: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Taxonomy = { pillars: string[]; services: string[]; funnel: string[]; ctas: string[] };

export const DEFAULT_TAXONOMY: Taxonomy = {
  pillars: [
    'Entender la IA',
    'IA en el trabajo',
    'Anti-humo',
    'Adopción en organizaciones',
    'Detrás de Squai',
  ],
  services: ['One', 'Grow', 'Learn'],
  funnel: ['TOFU', 'MOFU', 'BOFU'],
  ctas: ['Lista de espera', 'Inscripción', 'Diagnóstico'],
};

const HUMAN_TRANSITIONS: Record<Status, Status[]> = {
  idea: [],
  produciendo: [],
  revision: ['ajustes', 'aprobada'],
  ajustes: [],
  aprobada: ['revision'],
  publicando: [],
  publicada: [],
  error: ['idea', 'revision', 'aprobada'],
};

export function canHumanMove(from: Status, to: Status): boolean {
  return HUMAN_TRANSITIONS[from].includes(to);
}

export function isStatus(value: unknown): value is Status {
  return STATUSES.includes(value as Status);
}

export function isFormat(value: unknown): value is Format {
  return FORMATS.includes(value as Format);
}

const EMOJI = /\p{Extended_Pictographic}/gu;
const MAX_CAPTION = 2200;
const MAX_HASHTAGS = 30;

export function proposalViolations(format: Format, copy: string, slides: Slide[]): string[] {
  const problems: string[] = [];
  if (!copy.trim()) problems.push('El copy está vacío.');
  if (copy.length > MAX_CAPTION) problems.push(`El copy supera ${MAX_CAPTION} caracteres.`);
  if ((copy.match(EMOJI) ?? []).length > 1) problems.push('El copy admite máximo un emoji.');
  if ((copy.match(/#[\p{L}\p{N}_]+/gu) ?? []).length > MAX_HASHTAGS) {
    problems.push(`El copy supera ${MAX_HASHTAGS} hashtags.`);
  }
  const visualText = slides.map((slide) => `${slide.kicker} ${slide.title} ${slide.body}`).join(' ');
  if (EMOJI.test(visualText)) problems.push('La pieza visual no admite emojis.');
  EMOJI.lastIndex = 0;
  if (format === 'carrusel' && (slides.length < 2 || slides.length > 10)) {
    problems.push('Un carrusel necesita entre 2 y 10 láminas.');
  }
  if ((format === 'post' || format === 'story') && slides.length !== 1) {
    problems.push('Un post o story necesita exactamente una lámina.');
  }
  if (slides.some((slide) => !slide.title.trim())) problems.push('Cada lámina necesita título.');
  return problems;
}
