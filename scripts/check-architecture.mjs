import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse } from '@babel/parser';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(directory, entry.name)) : join(directory, entry.name),
      ),
    )
  ).flat();
}

const failures = [];
for (const path of [
  ...(await files('src')),
  ...(await files('tests')),
  ...(await files('scripts')),
]) {
  if (!/\.(ts|mjs)$/.test(path)) continue;
  const source = await readFile(path, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  if (ast.comments.length) failures.push(`${path}: code comments are prohibited`);
  const layer = path.startsWith('src/')
    ? relative('src', path)
        .split('/')
        .find((part) => ['domain', 'application', 'infrastructure', 'presentation'].includes(part))
    : undefined;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const dependency = node.source.value;
    if (
      ['domain', 'application'].includes(layer) &&
      /hono|jose|platform|infrastructure|presentation/.test(dependency)
    )
      failures.push(`${path}: ${layer} cannot import ${dependency}`);
    if (layer === 'domain' && dependency.includes('application'))
      failures.push(`${path}: domain cannot import application`);
  }
}
if (failures.length) throw new Error(failures.join('\n'));
console.log('Architecture boundaries and comment policy passed');
