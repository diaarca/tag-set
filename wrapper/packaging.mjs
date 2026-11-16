import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} failed (${result.status}).${result.stderr?.toString().trim() ? `\n${result.stderr.toString().trim()}` : ''}`,
    );
  return result.stdout;
}

export async function buildInterface() {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  if (
    manifest.name !== 'set-wise-music-player' ||
    !/^\d+\.\d+\.\d+$/.test(manifest.version)
  )
    throw new Error(
      'Run this command from the Setwise repository root with a valid release version.',
    );
  try {
    await access('node_modules/vite/bin/vite.js');
  } catch {
    throw new Error('Install dependencies first: nix develop --command npm ci');
  }
  run(process.execPath, [
    'node_modules/vite/bin/vite.js',
    'build',
    '--config',
    'wrapper/vite.config.ts',
  ]);
  return manifest;
}

export async function copyApplication(destination, version) {
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'setwise-wrapper',
        productName: 'Setwise Wrapper',
        version,
        type: 'module',
        main: 'desktop/main.mjs',
      },
      null,
      2,
    ) + '\n',
  );
  await cp('wrapper/bundle', join(destination, 'bundle'), { recursive: true });
  await cp('wrapper/desktop', join(destination, 'desktop'), {
    recursive: true,
    filter: (path) => !path.endsWith('.d.mts'),
  });
  await mkdir(join(destination, 'ui'));
  await cp('wrapper/ui/protocol.js', join(destination, 'ui/protocol.js'));
  await cp('wrapper/player-bridge.js', join(destination, 'player-bridge.js'));
}
