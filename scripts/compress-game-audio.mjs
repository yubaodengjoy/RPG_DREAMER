#!/usr/bin/env node

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const gameRoot = process.argv[2];
const minimumBytes = Number(process.env.RPG_AUDIO_MIN_BYTES ?? 200 * 1024);
const concurrency = Math.max(1, Number(process.env.RPG_AUDIO_JOBS ?? 6));
const ffmpeg = process.env.FFMPEG_BIN
  ?? (fs.existsSync('/mnt/c/ffmpeg/bin/ffmpeg.exe') ? '/mnt/c/ffmpeg/bin/ffmpeg.exe' : 'ffmpeg');

if (!gameRoot || !/^src-\d+$/.test(gameRoot)) {
  throw new Error('Usage: node scripts/compress-game-audio.mjs src-45');
}

const assets = path.join(root, gameRoot, 'src', 'dist', 'assets');
const bundleNames = fs.readdirSync(assets).filter((name) => /^index-.*\.js$/.test(name));
if (bundleNames.length !== 1) {
  throw new Error(`Expected one entry bundle in ${assets}; found ${bundleNames.length}.`);
}

function windowsPath(file) {
  const match = path.resolve(file).match(/^\/mnt\/([a-z])\/(.*)$/i);
  return match ? `${match[1].toUpperCase()}:\\${match[2].replaceAll('/', '\\')}` : file;
}

function runFfmpeg(file) {
  const output = file.replace(/\.wav$/i, '.mp3');
  const bitrate = /(?:bgm|music|loop)/i.test(path.basename(file)) ? '96k' : '64k';
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', windowsPath(file),
      '-map_metadata', '-1', '-vn', '-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', '44100',
      windowsPath(output),
    ], { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 && fs.existsSync(output) && fs.statSync(output).size > 0) {
        resolve({ file, output });
      } else {
        reject(new Error(`FFmpeg failed for ${file} (exit ${code}).`));
      }
    });
  });
}

const candidates = fs.readdirSync(assets)
  .filter((name) => name.endsWith('.wav'))
  .map((name) => path.join(assets, name))
  .filter((file) => fs.statSync(file).size >= minimumBytes);

const completed = [];
let nextIndex = 0;
async function worker() {
  while (nextIndex < candidates.length) {
    const file = candidates[nextIndex++];
    completed.push(await runFfmpeg(file));
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, candidates.length) }, worker));

const bundleFile = path.join(assets, bundleNames[0]);
let source = fs.readFileSync(bundleFile, 'utf8');
for (const { file, output } of completed) {
  source = source.replaceAll(path.basename(file), path.basename(output));
}
fs.writeFileSync(bundleFile, source);
for (const { file } of completed) fs.unlinkSync(file);

const sourceBytes = completed.reduce((sum, { file }) => sum + fs.statSync(file.replace(/\.wav$/i, '.mp3')).size, 0);
console.log(`Compressed ${completed.length} WAV assets for ${gameRoot}; MP3 output ${(sourceBytes / 1e6).toFixed(1)} MB.`);
