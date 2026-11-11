import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright-core';
import type { Slide } from './domain.ts';

export type RenderJob = { html: string; width: number; height: number; path: string };
export type Renderer = (jobs: RenderJob[]) => Promise<void>;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char]).replace(/\n/g, '<br>');
}

function position(index: number, total: number): string {
  if (total === 1) return 'single';
  if (index === 0) return 'first';
  return index === total - 1 ? 'last' : 'middle';
}

export function buildSlideHtml(
  template: string,
  tokens: string,
  slide: Slide,
  index: number,
  total: number,
): string {
  const values: Record<string, string> = {
    tokens,
    kicker: escapeHtml(slide.kicker),
    title: escapeHtml(slide.title),
    body: escapeHtml(slide.body),
    index: String(index + 1),
    total: String(total),
    position: position(index, total),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

export function chromiumRenderer(executablePath: string | undefined): Renderer {
  return async (jobs) => {
    const browser = await chromium.launch({ executablePath });
    try {
      for (const job of jobs) {
        mkdirSync(dirname(job.path), { recursive: true });
        const page = await browser.newPage({
          viewport: { width: job.width, height: job.height },
          deviceScaleFactor: 1,
        });
        await page.setContent(job.html, { waitUntil: 'networkidle' });
        await page.screenshot({ path: job.path, type: 'jpeg', quality: 92 });
        await page.close();
      }
    } finally {
      await browser.close();
    }
  };
}
