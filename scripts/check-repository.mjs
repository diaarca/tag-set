import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (${result.status}).`);
  return result.stdout;
}

try {
  const ignored = run(
    'git',
    [
      'ls-files',
      '--cached',
      '--ignored',
      '--exclude-per-directory=.gitignore',
      '-z',
    ],
    true,
  )
    .split('\0')
    .filter(Boolean);
  if (ignored.length)
    throw new Error(
      `Remove ignored files from Git tracking before pushing:\n${ignored.join('\n')}`,
    );

  const files = new Set(
    run(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      true,
    )
      .split('\0')
      .filter(Boolean),
  );
  await mkdir('.build', { recursive: true });
  const temporary = await mkdtemp(resolve('.build/security-'));
  try {
    for (const file of files) {
      let info;
      try {
        info = await lstat(file);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!info.isFile())
        throw new Error(`Review unsupported repository entry: ${file}`);
      const destination = join(temporary, file);
      await mkdir(dirname(destination), { recursive: true });
      await cp(file, destination);
    }
    run('gitleaks', [
      'dir',
      '--no-banner',
      '--redact=100',
      '--ignore-gitleaks-allow',
      temporary,
    ]);
    run('gitleaks', [
      'git',
      '--no-banner',
      '--redact=100',
      '--ignore-gitleaks-allow',
      '--log-opts=--all',
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
