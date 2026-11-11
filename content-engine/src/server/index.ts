import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { claudeExecutor, type Context } from './agents.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createStore } from './db.ts';
import { startPipeline } from './pipeline.ts';
import { instagramPublisher } from './publisher.ts';
import { chromiumRenderer } from './render.ts';
import { createWorkspace } from './workspace.ts';

const config = loadConfig();
mkdirSync(join(config.dataDir, 'media'), { recursive: true });

const ctx: Context = {
  config,
  store: createStore(join(config.dataDir, 'content.db')),
  workspace: createWorkspace(join(config.dataDir, 'workspace'), config.seedDir),
  executor: claudeExecutor(config.claudeBin),
  renderer: chromiumRenderer(config.chromiumPath),
  publish: instagramPublisher(),
};

startPipeline(ctx);
serve({ fetch: createApp(ctx).fetch, port: config.port });
console.log(`content-engine en ${config.publicUrl}`);
