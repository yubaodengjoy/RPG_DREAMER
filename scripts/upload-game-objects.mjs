#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const types = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.rpgpack': 'application/octet-stream',
};
for (const relativePath of process.argv.slice(2)) {
  const file = path.resolve(root, relativePath);
  const key = path.relative(root, file).replaceAll('\\', '/');
  if (key.startsWith('../') || !fs.statSync(file).isFile()) throw new Error(`Invalid upload path: ${relativePath}`);
  const type = types[path.extname(file)];
  if (!type) throw new Error(`Specify a content type for ${relativePath}`);
  let uploaded = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = spawnSync('npx', ['wrangler', 'r2', 'object', 'put', `data/rpg-dreamer/${key}`,
      '--file', file, '--remote', '--content-type', type], { cwd: root, encoding: 'utf8' });
    if (result.status === 0) { uploaded = true; break; }
    console.error(`Retry ${attempt}/3: ${key}\n${result.stderr || result.stdout}`);
  }
  if (!uploaded) throw new Error(`Upload failed: ${key}`);
  console.log(`Uploaded ${key} (${type})`);
}
