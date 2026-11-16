import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

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
