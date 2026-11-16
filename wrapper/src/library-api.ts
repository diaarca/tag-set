import { AppError } from '../../shared/errors.js';
import {
  id,
  object,
  playlistId,
  text,
  videoId,
} from '../../shared/validation.js';
import { LibraryStore } from './library.js';
import { MusicCatalog } from './catalog.js';

export interface LibraryHost {
  read(): Promise<string | null>;
  write(data: string, previous: string | null): Promise<void>;
}
export class LibraryApi {
  private library?: LibraryStore;
  private previous: string | null = null;
  private blocked?: Error;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private host: LibraryHost,
    private catalog: MusicCatalog,
  ) {}
  request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    const result = this.tail.then(() => this.perform(path, method, body));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async perform(path: string, method: string, body: unknown) {
    if (this.blocked) throw this.blocked;
    if (!this.library) {
      this.previous = await this.host.read();
      this.library = new LibraryStore(
        this.previous === null ? undefined : JSON.parse(this.previous),
      );
    }
    const url = new URL(path, 'https://setwise.local');
    if (method === 'GET') {
      if (url.pathname === '/library') return this.library.library();
      if (url.pathname === '/library/export')
        return this.library.exportLibrary();
      if (url.pathname === '/songs')
        return this.library.songs(
          url.searchParams.has('tagId')
            ? id(url.searchParams.get('tagId'))
            : undefined,
        );
      const song = /^\/songs\/(\d+)$/.exec(url.pathname);
      if (song) return this.library.details(id(song[1]));
      if (url.pathname === '/catalog/search')
        return this.catalog.search(
          text(url.searchParams.get('q'), 'Search query'),
        );
      throw new AppError(404, 'Not found.');
    }
    const staged = new LibraryStore(this.library.snapshot());
    const result = await this.mutate(staged, url.pathname, method, body);
    const data = JSON.stringify(staged.snapshot());
    if (new TextEncoder().encode(data).byteLength > 8 * 1024 * 1024)
      throw new AppError(
        400,
        'The library would exceed the 8 MiB storage limit. No changes were saved.',
      );
    try {
      await this.host.write(data, this.previous);
    } catch (error) {
      this.blocked = new Error(
        `The library could not be saved: ${error instanceof Error ? error.message : 'Storage failed.'} Reopen Setwise before editing again.`,
      );
      throw this.blocked;
    }
    this.previous = data;
    this.library = staged;
    return result;
  }
  private async mutate(
    store: LibraryStore,
    path: string,
    method: string,
    body: unknown,
  ) {
    if (method === 'POST' && path === '/songs/import') {
      const video = videoId(object(body).url);
      const previous = store.findByVideoId(video);
      if (previous) return store.details(previous.id);
      const song = await this.catalog.lookup(video);
      return store.details(
        store.saveSong({
          ...song,
          url: `https://music.youtube.com/watch?v=${video}`,
        }),
      );
    }
    if (method === 'POST' && path === '/playlists/import') {
      const input = object(body),
        playlist = playlistId(input.url);
      return store.importPlaylist(
        await this.catalog.playlist(playlist),
        input.tagName === undefined
          ? undefined
          : text(input.tagName, 'Tag name'),
      );
    }
    if (method === 'POST' && path === '/library/import')
      return store.merge(body);
    if (method === 'POST' && path === '/songs')
      return store.details(store.saveSong(body));
    if (method === 'POST' && path === '/tags')
      return { id: store.createTag(body) };
    const song = /^\/songs\/(\d+)$/.exec(path),
      tag = /^\/tags\/(\d+)$/.exec(path);
    if (song && method === 'PUT')
      return store.details(store.saveSong(body, id(song[1])));
    if (song && method === 'DELETE') return store.deleteSong(id(song[1]));
    if (tag && method === 'PATCH') return store.updateTag(id(tag[1]), body);
    if (tag && method === 'DELETE') return store.deleteTag(id(tag[1]));
    const assignment = /^\/songs\/(\d+)\/tags\/(\d+)$/.exec(path);
    const edge = /^\/tags\/(\d+)\/children\/(\d+)$/.exec(path);
    if (['PUT', 'DELETE'].includes(method)) {
      if (assignment)
        return store.assign(
          id(assignment[1]),
          id(assignment[2]),
          method === 'PUT',
        );
      if (edge) return store.relate(id(edge[1]), id(edge[2]), method === 'PUT');
    }
    throw new AppError(404, 'Not found.');
  }
}
