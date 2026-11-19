import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

test('packages runtime files and licenses without adjacent private files', async () => {
  await mkdir('.build', { recursive: true });
  const root = await mkdtemp(resolve('.build/packaging-'));
  const expected = {
    bundle: [
      'index.html',
      'app.js',
      'style.css',
      'icon.png',
      'LICENSE.txt',
      'NOTICE.txt',
    ],
    desktop: [
      'main.mjs',
      'catalog.mjs',
      'github.mjs',
      'storage.mjs',
      'navigation.mjs',
      'preload.cjs',
      'playback-preload.cjs',
    ],
  };
  try {
    for (const [directory, files] of Object.entries(expected)) {
      await mkdir(join(root, 'wrapper', directory), { recursive: true });
      for (const file of [...files, '.env', 'library.json', 'Cookies'])
        await writeFile(join(root, 'wrapper', directory, file), file);
    }
    for (const file of ['protocol.js', 'player-bridge.js'])
      await writeFile(join(root, 'wrapper', file), file);
    const module = new URL('../wrapper/packaging.mjs', import.meta.url).href;
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { copyApplication } from ${JSON.stringify(module)}; await copyApplication('output', '0.1.0');`,
      ],
      { cwd: root },
    );
    for (const [directory, files] of Object.entries(expected))
      assert.deepEqual(
        (await readdir(join(root, 'output', directory))).sort(),
        files.toSorted(),
      );
    assert.equal(
      JSON.parse(await readFile(join(root, 'output/package.json'), 'utf8'))
        .productName,
      'TagSet',
    );
    for (const file of ['protocol.js', 'player-bridge.js'])
      assert.equal(await readFile(join(root, 'output', file), 'utf8'), file);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
