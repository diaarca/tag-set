import { cp, mkdir, mkdtemp, rename, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildInterface, copyApplication, run } from './packaging.mjs';

async function build() {
  if (process.platform !== 'darwin') throw new Error('Build the DMG on macOS.');
  const [electronArchive, ...extra] = process.argv.slice(2);
  if (!electronArchive || extra.length)
    throw new Error('Run nix run .#dmg from the repository root.');
  const root = process.cwd();
  const manifest = await buildInterface();
  const output = resolve(root, 'dist/releases');
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(output, '.dmg-'));
  try {
    const staging = join(work, 'image');
    await mkdir(staging);
    const app = join(staging, 'TagSet.app');
    const runtime = join(work, 'runtime');
    run('/usr/bin/ditto', ['-x', '-k', electronArchive, runtime]);
    await rename(join(runtime, 'Electron.app'), app);
    const resources = join(app, 'Contents/Resources');
    for (const filename of ['LICENSE', 'LICENSES.chromium.html'])
      await cp(join(runtime, filename), join(resources, filename));
    await rm(join(resources, 'default_app.asar'), { force: true });
    await copyApplication(join(resources, 'app'), manifest.version);
    const plist = join(app, 'Contents/Info.plist');
    for (const [key, value] of Object.entries({
      CFBundleName: 'TagSet',
      CFBundleDisplayName: 'TagSet',
      CFBundleIdentifier: 'dev.dylan.Setwise.Wrapper.desktop',
      CFBundleShortVersionString: manifest.version,
      CFBundleVersion: manifest.version,
      LSApplicationCategoryType: 'public.app-category.music',
    }))
      run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist]);
    run('/usr/libexec/PlistBuddy', [
      '-c',
      'Delete :ElectronAsarIntegrity',
      plist,
    ]);
    run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    await symlink('/Applications', join(staging, 'Applications'));
    const image = join(work, 'TagSet.dmg');
    run('/usr/bin/hdiutil', [
      'create',
      '-volname',
      'TagSet',
      '-srcfolder',
      staging,
      '-format',
      'UDZO',
      image,
    ]);
    run('/usr/bin/hdiutil', ['verify', image]);
    const filename = `TagSet-${manifest.version}-${process.arch}.dmg`;
    await rename(image, join(output, filename));
    console.log(
      `\nCreated ${join(output, filename)}\nOpen the DMG and drag TagSet into Applications.\nThis build is ad-hoc signed and is not notarized.`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
