import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { buildInterface, copyApplication, run } from './packaging.mjs';
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit';

function nsisText(value) {
  return value
    .replaceAll('$', () => '$$')
    .replaceAll('"', '$\\"')
    .replaceAll('\r', '$\\r')
    .replaceAll('\n', '$\\n');
}

async function uninstallCommands(root, directory = root) {
  const commands = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = join(directory, entry.name);
    const path = nsisText(
      relative(root, filename).replaceAll('\\', '/').replaceAll('/', '\\'),
    );
    if (entry.isDirectory()) {
      commands.push(
        ...(await uninstallCommands(root, filename)),
        `RMDir "$INSTDIR\\${path}"`,
      );
    } else commands.push(`Delete "$INSTDIR\\${path}"`);
  }
  return commands;
}

async function build() {
  const [target, archive, ...extra] = process.argv.slice(2);
  if (
    !['windows-x64', 'linux-x64', 'linux-arm64'].includes(target) ||
    !archive ||
    extra.length
  )
    throw new Error(
      'Run nix run .#windows, .#linux, or .#linux-arm64 from the repository root.',
    );
  const manifest = await buildInterface();
  const output = resolve('dist/releases');
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(output, `.${target}-`));
  try {
    const application = join(work, 'TagSet');
    await mkdir(application);
    run('unzip', ['-q', archive, '-d', application]);
    await rm(join(application, 'resources/default_app.asar'), { force: true });
    await copyApplication(join(application, 'resources/app'), manifest.version);
    const base = `TagSet-${manifest.version}-${target}`;
    if (target === 'windows-x64') {
      await rename(
        join(application, 'electron.exe'),
        join(application, 'TagSet.exe'),
      );
      const executablePath = join(application, 'TagSet.exe');
      // Branding replaces Electron's vendor signature; packages are unsigned.
      const executable = NtExecutable.from(await readFile(executablePath), {
        ignoreCert: true,
      });
      const resources = NtExecutableResource.from(executable);
      const groups = Resource.IconGroupEntry.fromEntries(resources.entries);
      if (groups.length !== 1)
        throw new Error('Expected one Electron application icon group.');
      const icon = Data.IconFile.from(
        await readFile('wrapper/assets/icon.ico'),
      );
      Resource.IconGroupEntry.replaceIconsForResource(
        resources.entries,
        groups[0].id,
        groups[0].lang,
        icon.icons.map((item) => item.data),
      );
      resources.outputResource(executable);
      await writeFile(executablePath, Buffer.from(executable.generate()));
      const uninstall = join(work, 'uninstall-files.nsh');
      await writeFile(
        uninstall,
        (await uninstallCommands(application)).join('\n') + '\n',
      );
      const installer = join(work, `${base}-setup.exe`);
      run('makensis', [
        `-DVERSION=${manifest.version}`,
        `-DSOURCE_DIR=${nsisText(application)}`,
        `-DOUTPUT_FILE=${nsisText(installer)}`,
        `-DUNINSTALL_FILES=${nsisText(uninstall)}`,
        `-DAPP_ICON=${nsisText(resolve('wrapper/assets/icon.ico'))}`,
        resolve('wrapper/windows-installer.nsi'),
      ]);
      await rename(installer, join(output, `${base}-setup.exe`));
      console.log(
        `Created ${join(output, `${base}-setup.exe`)} (per-user installer, no administrator rights required).`,
      );
    } else {
      await rename(join(application, 'electron'), join(application, 'tagset'));
      await chmod(join(application, 'tagset'), 0o755);
      await chmod(join(application, 'chrome-sandbox'), 0o755);
      await writeFile(
        join(application, 'README.txt'),
        'TagSet\n\nExtract this archive, then run ./TagSet/tagset.\nRequires Linux desktop libraries and Chromium user-namespace sandbox support.\nYour library is stored separately in your user configuration directory.\n',
      );
      const filename = `${base}.tar.gz`;
      run('tar', [
        '--owner=0',
        '--group=0',
        '-czf',
        join(work, filename),
        '-C',
        work,
        'TagSet',
      ]);
      await rename(join(work, filename), join(output, filename));
      console.log(
        `Created ${join(output, filename)}. Extract and run ./TagSet/tagset.`,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
