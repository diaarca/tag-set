import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { buildInterface, run } from './packaging.mjs';

async function build() {
  if (process.platform !== 'darwin')
    throw new Error('Build the iOS app on a Mac with full Xcode installed.');
  const { values } = parseArgs({
    options: {
      device: { type: 'string' },
      team: { type: 'string' },
      'list-devices': { type: 'boolean' },
      'allow-provisioning-updates': { type: 'boolean' },
      open: { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'nix run .#xcode                      Build the interface and open the iOS project in Xcode.\nnix run .#ios                        Build an unsigned device archive (not installable).\nnix run .#ios -- --list-devices       List devices known to Xcode.\nnix run .#ios -- --device ID --team TEAMID\n                                    Build, sign and install on a connected device.\nAdd --allow-provisioning-updates only to allow Xcode to manage signing profiles.',
    );
    return;
  }
  if (values.device && !/^[A-Za-z0-9-]{4,80}$/.test(values.device))
    throw new Error('Invalid device identifier.');
  if (values.team && !/^[A-Z0-9]{10}$/.test(values.team))
    throw new Error('Apple team IDs contain 10 uppercase letters or digits.');
  if (!values.device && (values.team || values['allow-provisioning-updates']))
    throw new Error(
      '--team and --allow-provisioning-updates require --device.',
    );
  if (
    values.open &&
    (values.device ||
      values.team ||
      values['list-devices'] ||
      values['allow-provisioning-updates'])
  )
    throw new Error(
      '--open cannot be combined with device or signing options.',
    );
  const env = { ...process.env, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' };
  for (const key of Object.keys(env)) {
    if (
      key.startsWith('NIX_') ||
      [
        'CC',
        'CXX',
        'LD',
        'AR',
        'AS',
        'NM',
        'RANLIB',
        'STRIP',
        'SWIFT_EXEC',
        'SDKROOT',
        'TOOLCHAINS',
        'CFLAGS',
        'CXXFLAGS',
        'CPPFLAGS',
        'LDFLAGS',
        'LIBRARY_PATH',
        'DYLD_LIBRARY_PATH',
        'DYLD_FRAMEWORK_PATH',
      ].includes(key)
    )
      delete env[key];
  }
  if (env.DEVELOPER_DIR?.startsWith('/nix/')) delete env.DEVELOPER_DIR;
  if (!env.DEVELOPER_DIR) {
    const selected = run('/usr/bin/xcode-select', ['-p'], {
      env,
      stdio: 'pipe',
      encoding: 'utf8',
    }).trim();
    env.DEVELOPER_DIR = selected.endsWith('/CommandLineTools')
      ? '/Applications/Xcode.app/Contents/Developer'
      : selected;
  }
  try {
    await access(join(env.DEVELOPER_DIR, 'usr/bin/xcodebuild'));
  } catch {
    throw new Error(
      'Full Xcode is required. Select it with DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer.',
    );
  }
  const apple = (command, args, options = {}) =>
    run(command, args, { env, ...options });
  if (values['list-devices']) {
    apple('/usr/bin/xcrun', ['xctrace', 'list', 'devices']);
    return;
  }
  const manifest = await buildInterface();
  const project = resolve('apple/TagSet.xcodeproj');
  try {
    await access('apple/Config/Signing.local.xcconfig');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    let source = '';
    try {
      source = await readFile(join(project, 'project.pbxproj'), 'utf8');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const teams = new Set(
      [...source.matchAll(/DEVELOPMENT_TEAM = "?([A-Z0-9]{10})"?;/g)].map(
        (match) => match[1],
      ),
    );
    if (teams.size === 1)
      await writeFile(
        'apple/Config/Signing.local.xcconfig',
        `DEVELOPMENT_TEAM = ${[...teams][0]}\n`,
        { flag: 'wx' },
      );
  }
  run('xcodegen', ['generate', '--spec', 'apple/wrapper.yml', '--use-cache']);
  const packageResolution = join(
    project,
    'project.xcworkspace/xcshareddata/swiftpm',
  );
  await mkdir(packageResolution, { recursive: true });
  await copyFile(
    'apple/Package.resolved',
    join(packageResolution, 'Package.resolved'),
  );
  if (values.open) {
    apple('/usr/bin/open', ['-a', 'Xcode', project]);
    return;
  }
  const base = [
    '-project',
    project,
    '-scheme',
    'TagSet-iOS',
    '-configuration',
    'Release',
  ];
  const version = [
    `MARKETING_VERSION=${manifest.version}`,
    'CURRENT_PROJECT_VERSION=1',
  ];
  if (values.device) {
    const settings = JSON.parse(
      apple('/usr/bin/xcodebuild', [...base, '-showBuildSettings', '-json'], {
        stdio: 'pipe',
        encoding: 'utf8',
      }),
    );
    const team =
      values.team ??
      settings.find((row) => row.target === 'TagSet-iOS')?.buildSettings
        .DEVELOPMENT_TEAM;
    if (!team)
      throw new Error(
        'Choose your Personal Team in Xcode, or pass --team YOURTEAMID.',
      );
    const derived = resolve('apple/.build/DerivedData-Wrapper-Install');
    apple('/usr/bin/xcodebuild', [
      ...base,
      '-sdk',
      'iphoneos',
      '-destination',
      `id=${values.device}`,
      '-derivedDataPath',
      derived,
      'build',
      ...version,
      'CODE_SIGN_STYLE=Automatic',
      `DEVELOPMENT_TEAM=${team}`,
      ...(values['allow-provisioning-updates']
        ? ['-allowProvisioningUpdates']
        : []),
    ]);
    const application = join(
      derived,
      'Build/Products/Release-iphoneos/TagSet-iOS.app',
    );
    await access(join(application, 'embedded.mobileprovision'));
    apple('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
    apple('/usr/bin/xcrun', [
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      values.device,
      application,
    ]);
    console.log(
      'Installed TagSet. Free Personal Team signing needs renewal, normally after seven days.',
    );
    return;
  }
  const output = resolve('dist/releases');
  await mkdir(output, { recursive: true });
  const work = await mkdtemp(join(output, '.ios-'));
  try {
    const archive = join(work, 'TagSet.xcarchive');
    apple('/usr/bin/xcodebuild', [
      ...base,
      '-sdk',
      'iphoneos',
      '-destination',
      'generic/platform=iOS',
      '-derivedDataPath',
      resolve('apple/.build/DerivedData-Wrapper-Archive'),
      '-archivePath',
      archive,
      'archive',
      ...version,
      'CODE_SIGNING_ALLOWED=NO',
    ]);
    await access(
      join(archive, 'Products/Applications/TagSet-iOS.app/bundle/index.html'),
    );
    const destination = join(
      output,
      `TagSet-${manifest.version}-ios.xcarchive`,
    );
    await rm(destination, { recursive: true, force: true });
    await rename(archive, destination);
    console.log(
      `Created ${destination}\nThis unsigned archive cannot be installed directly.\nTo sign and install with a free Personal Team, run nix run .#ios -- --device DEVICE_ID --team TEAM_ID.`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

build().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
