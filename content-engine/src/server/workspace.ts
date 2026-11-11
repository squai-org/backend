import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Format } from './domain.ts';

export const KINDS = ['bases', 'templates', 'skills', 'agents'] as const;
export type Kind = (typeof KINDS)[number];

type KindSpec = { dir: string; extensions: string[]; nested?: string };

const SPECS: Record<Kind, KindSpec> = {
  bases: { dir: 'bases', extensions: ['.md'] },
  templates: { dir: 'templates', extensions: ['.html', '.css'] },
  skills: { dir: '.claude/skills', extensions: [], nested: 'SKILL.md' },
  agents: { dir: '.claude/agents', extensions: ['.md'] },
};

const NAME = /^[a-z0-9][a-z0-9-]*(\.[a-z]+)?$/;

export type TemplateInfo = { name: string; width: number; height: number; formats: string[] };

export function isKind(value: string): value is Kind {
  return KINDS.includes(value as Kind);
}

export function createWorkspace(root: string, seedDir: string) {
  if (!existsSync(root)) {
    mkdirSync(dirname(root), { recursive: true });
    cpSync(seedDir, root, { recursive: true });
  }

  function pathFor(kind: Kind, name: string): string {
    const spec = SPECS[kind];
    if (!NAME.test(name)) throw new Error('Nombre inválido.');
    if (spec.nested) {
      if (name.includes('.')) throw new Error('Nombre inválido.');
      return join(root, spec.dir, name, spec.nested);
    }
    if (!spec.extensions.some((extension) => name.endsWith(extension))) {
      throw new Error(`Extensión permitida: ${spec.extensions.join(', ')}.`);
    }
    return join(root, spec.dir, name);
  }

  function list(kind: Kind): string[] {
    const spec = SPECS[kind];
    const dir = join(root, spec.dir);
    if (!existsSync(dir)) return [];
    const entries = readdirSync(dir, { withFileTypes: true });
    const names = spec.nested
      ? entries
          .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
          .map((entry) => entry.name)
      : entries
          .filter((entry) => entry.isFile() && spec.extensions.some((e) => entry.name.endsWith(e)))
          .map((entry) => entry.name);
    return names.sort();
  }

  function read(kind: Kind, name: string): string | null {
    const path = pathFor(kind, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  }

  function templateInfo(name: string): TemplateInfo | null {
    const html = read('templates', name);
    if (!html || !name.endsWith('.html')) return null;
    const size = /<meta name="size" content="(\d+)x(\d+)"/.exec(html);
    const formats = /<meta name="formats" content="([^"]+)"/.exec(html);
    if (!size || !formats) return null;
    return {
      name,
      width: Number(size[1]),
      height: Number(size[2]),
      formats: formats[1].split(',').map((format) => format.trim()),
    };
  }

  function templatesFor(format: Format): TemplateInfo[] {
    return list('templates')
      .map(templateInfo)
      .filter((info): info is TemplateInfo => info?.formats.includes(format) ?? false);
  }

  return {
    root,
    list,
    read,
    templatesFor,

    write(kind: Kind, name: string, content: string): void {
      const path = pathFor(kind, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },

    remove(kind: Kind, name: string): void {
      const path = pathFor(kind, name);
      rmSync(SPECS[kind].nested ? dirname(path) : path, { recursive: true, force: true });
    },

    pickTemplate(preferred: string, format: Format): TemplateInfo {
      const options = templatesFor(format);
      const match = options.find((option) => option.name === preferred) ?? options[0];
      if (!match) throw new Error(`No hay template para el formato ${format}.`);
      return match;
    },

    tokens(): string {
      return read('templates', 'tokens.css') ?? '';
    },

    appendLearning(text: string): void {
      const path = join(root, 'bases', 'aprendizajes.md');
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `\n- ${text.trim().replace(/\s+/g, ' ')}\n`);
    },
  };
}

export type Workspace = ReturnType<typeof createWorkspace>;
