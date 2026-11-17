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
  if (manifest.name !== 'tag-set' || !/^\d+\.\d+\.\d+$/.test(manifest.version))
    throw new Error(
      'Run this command from the TagSet repository root with a valid release version.',
    );
  try {
    await access('node_modules/vite/bin/vite.js');
  } catch {
    throw new Error('Install dependencies first: nix develop --command npm ci');
  }
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build']);
  return manifest;
}

export async function copyApplication(destination, version) {
  await mkdir(destination, { recursive: true });
  await writeFile(
    join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'tag-set',
        productName: 'TagSet',
        version,
        type: 'module',
        main: 'desktop/main.mjs',
      },
      null,
      2,
    ) + '\n',
  );
  // Package only runtime files, including when ignored local files exist nearby.
  for (const [directory, files] of [
    [
      'bundle',
      ['index.html', 'app.js', 'style.css', 'LICENSE.txt', 'NOTICE.txt'],
    ],
    [
      'desktop',
      [
        'main.mjs',
        'catalog.mjs',
        'github.mjs',
        'storage.mjs',
        'navigation.mjs',
        'preload.cjs',
        'playback-preload.cjs',
      ],
    ],
  ]) {
    await mkdir(join(destination, directory), { recursive: true });
    for (const file of files)
      await cp(
        join('wrapper', directory, file),
        join(destination, directory, file),
      );
  }
  await cp('wrapper/protocol.js', join(destination, 'protocol.js'));
  await cp('wrapper/player-bridge.js', join(destination, 'player-bridge.js'));
}
