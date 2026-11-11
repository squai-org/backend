import { resolve } from 'node:path';

export type Config = {
  port: number;
  publicUrl: string;
  adminPassword: string;
  sessionSecret: string;
  timezone: string;
  dataDir: string;
  seedDir: string;
  webDir: string;
  claudeBin: string;
  chromiumPath: string | undefined;
  igUserId: string;
  igAccessToken: string;
  igGraphUrl: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8787);
  const adminPassword = env.ADMIN_PASSWORD ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';
  if (!adminPassword || !sessionSecret) {
    throw new Error('ADMIN_PASSWORD y SESSION_SECRET son obligatorios.');
  }
  return {
    port,
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, ''),
    adminPassword,
    sessionSecret,
    timezone: env.TIMEZONE ?? 'America/Bogota',
    dataDir: resolve(env.DATA_DIR ?? 'data'),
    seedDir: resolve('seed'),
    webDir: resolve('dist/web'),
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    chromiumPath: env.CHROMIUM_PATH || undefined,
    igUserId: env.IG_USER_ID ?? '',
    igAccessToken: env.IG_ACCESS_TOKEN ?? '',
    igGraphUrl: (env.IG_GRAPH_URL ?? 'https://graph.instagram.com').replace(/\/$/, ''),
  };
}
