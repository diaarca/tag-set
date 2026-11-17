import { LibraryApi } from './library-api.js';
import { MusicCatalog } from './catalog.js';
import { request } from './host.js';

const local = new LibraryApi(
  {
    async read() {
      const value = await request('readLibrary');
      if (value !== null && typeof value !== 'string')
        throw new Error('The device returned an invalid library.');
      return value;
    },
    async write(data, previous) {
      await request('writeLibrary', { data, previous });
    },
    async activateLocation(token, data, previous) {
      const value = await request('activateLibraryLocation', {
        token,
        data,
        previous,
      });
      if (typeof value !== 'string')
        throw new Error('The device returned an invalid library.');
      return value;
    },
  },
  new MusicCatalog((endpoint, body) => request('catalog', { endpoint, body })),
);

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  return (await local.request(path, method, body)) as T;
}

export async function exportLibrary() {
  await request('exportLibrary', JSON.stringify(await api('/library/export')));
}
