import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import '../protocol.js';

export function createPreferencesStorage(filename) {
  return {
    async read() {
      try {
        if ((await stat(filename)).size > 65536)
          throw new Error('Settings file is too large.');
        return await readFile(filename, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    },
    async write(value) {
      if (typeof value !== 'string' || Buffer.byteLength(value) > 65536)
        throw new Error('Invalid settings.');
      const settings = globalThis.tagsetProtocol.validatePreferences(
        JSON.parse(value),
      );
      await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
      await atomicWrite(filename, JSON.stringify(settings));
    },
  };
}

export const maxLibraryBytes = 8 * 1024 * 1024;
export function libraryText(value) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > maxLibraryBytes)
    throw new Error('A library file must be at most 8 MiB.');
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object' || parsed.version !== 1)
    throw new Error('Unsupported library format.');
  return value;
}
export async function atomicWrite(filename, data) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data, { flag: 'wx', mode: 0o600, flush: true });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
export function createLibraryStorage(filename) {
  let tail = Promise.resolve();
  const read = async () => {
    try {
      if ((await stat(filename)).size > maxLibraryBytes)
        throw new Error('The library is larger than 8 MiB.');
      return new TextDecoder('utf-8', { fatal: true }).decode(
        await readFile(filename),
      );
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  };
  return {
    read,
    write(data, previous) {
      const operation = tail.then(async () => {
        libraryText(data);
        if (previous !== null && typeof previous !== 'string')
          throw new Error('Invalid previous library version.');
        if ((await read()) !== previous)
          throw new Error('The library changed in another window.');
        await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
        await atomicWrite(filename, data);
      });
      tail = operation.catch(() => {});
      return operation;
    },
  };
}

export function createLibraryLocationStorage(defaultFilename, configFilename) {
  let filename, storage, pending;
  let tail = Promise.resolve();
  const initialize = async () => {
    if (storage) return;
    let selected = defaultFilename;
    try {
      if ((await stat(configFilename)).size > 65536)
        throw new Error('Invalid saved library location.');
      const config = JSON.parse(await readFile(configFilename, 'utf8'));
      if (
        config.version !== 1 ||
        typeof config.filename !== 'string' ||
        !isAbsolute(config.filename)
      )
        throw new Error('Invalid saved library location.');
      selected = config.filename;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    filename = selected;
    storage = createLibraryStorage(filename);
  };
  const run = (action) => {
    const operation = tail.then(initialize).then(action);
    tail = operation.catch(() => {});
    return operation;
  };
  const read = async () => {
    const data = await storage.read();
    if (data === null && filename !== defaultFilename)
      throw new Error(
        'The selected library is unavailable. Restore access or choose another folder.',
      );
    return data;
  };
  const location = () => ({
    path: filename,
    isDefault: filename === defaultFilename,
  });
  return {
    read: () => run(read),
    write: (data, previous) =>
      run(async () => {
        await read();
        await storage.write(data, previous);
      }),
    location: () => run(location),
    prepare: (folder) =>
      run(async () => {
        pending = undefined;
        if (
          folder !== null &&
          (typeof folder !== 'string' ||
            !isAbsolute(folder) ||
            !(await stat(folder)).isDirectory())
        )
          throw new Error('Choose an existing library folder.');
        const target =
          folder === null ? defaultFilename : resolve(folder, 'library.json');
        const data = await createLibraryStorage(target).read();
        if (data !== null) libraryText(data);
        pending = { token: randomUUID(), filename: target, data };
        return { token: pending.token, path: target, data };
      }),
    cancel: () =>
      run(() => {
        pending = undefined;
      }),
    activate: (token, data, previous) =>
      run(async () => {
        if (!pending || token !== pending.token)
          throw new Error('Choose the library folder again.');
        const target = pending;
        const next = createLibraryStorage(target.filename);
        if ((await next.read()) !== target.data)
          throw new Error(
            'The folder library changed. Choose the folder again.',
          );
        let selected = target.data;
        if (selected === null) {
          libraryText(data);
          if ((await read()) !== previous)
            throw new Error(
              'The current library changed. Reload it before switching folders.',
            );
          await next.write(data, null);
          selected = data;
        }
        await mkdir(dirname(configFilename), { recursive: true, mode: 0o700 });
        await atomicWrite(
          configFilename,
          JSON.stringify({ version: 1, filename: target.filename }),
        );
        filename = target.filename;
        storage = next;
        pending = undefined;
        return selected;
      }),
  };
}
