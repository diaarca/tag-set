import type {
  CatalogPlaylist,
  Library,
  Song,
  SongDetails,
  SongMembership,
  TagEdge,
} from '../../shared/types.js';
import { AppError } from '../../shared/errors.js';
import {
  artistNames,
  id,
  object,
  text,
  videoId,
} from '../../shared/validation.js';

interface StoredTag {
  id: number;
  name: string;
  pinned: boolean;
}
interface Assignment {
  songId: number;
  tagId: number;
  origin: 'manual' | 'artist';
}
export interface LibraryData {
  version: 1;
  nextSongId: number;
  nextTagId: number;
  songs: Song[];
  tags: StoredTag[];
  edges: TagEdge[];
  assignments: Assignment[];
}
const empty = (): LibraryData => ({
  version: 1,
  nextSongId: 1,
  nextTagId: 1,
  songs: [],
  tags: [],
  edges: [],
  assignments: [],
});
const order = (
  a: { id: number; title: string },
  b: { id: number; title: string },
) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) ||
  a.id - b.id;

function rows(
  input: Record<string, unknown>,
  key: string,
  limit: number,
): unknown[] {
  const value = input[key];
  if (!Array.isArray(value) || value.length > limit)
    throw new AppError(400, `Invalid library ${key}.`);
  return value;
}

export class PortableLibrary {
  private data: LibraryData;
  constructor(value?: unknown) {
    if (value === undefined) {
      this.data = empty();
      return;
    }
    const input = object(value);
    if (input.version !== 1)
      throw new AppError(
        400,
        'This library format is not supported. Your existing file has not been changed.',
      );
    const songs = rows(input, 'songs', 50_000).map((value) => {
      const row = object(value);
      if (typeof row.videoId !== 'string' || !/^[\w-]{11}$/.test(row.videoId))
        throw new AppError(400, 'Invalid library song.');
      return {
        id: id(row.id),
        videoId: row.videoId,
        title: text(row.title, 'Title', 500),
        artists: artistNames(row.artists),
      };
    });
    const tags = rows(input, 'tags', 20_000).map((value) => {
      const row = object(value);
      if (typeof row.pinned !== 'boolean')
        throw new AppError(400, 'Invalid library pin state.');
      return {
        id: id(row.id),
        name: text(row.name, 'Tag name'),
        pinned: row.pinned,
      };
    });
    const songIDs = new Set(songs.map((song) => song.id));
    const tagIDs = new Set(tags.map((tag) => tag.id));
    if (
      songIDs.size !== songs.length ||
      tagIDs.size !== tags.length ||
      new Set(songs.map((song) => song.videoId)).size !== songs.length ||
      new Set(tags.map((tag) => tag.name.toLowerCase())).size !== tags.length
    )
      throw new AppError(400, 'The library contains duplicate songs or tags.');
    const edges = rows(input, 'edges', 100_000).map((value) => {
      const row = object(value);
      const edge = { parentId: id(row.parentId), childId: id(row.childId) };
      if (!tagIDs.has(edge.parentId) || !tagIDs.has(edge.childId))
        throw new AppError(
          400,
          'A library relationship references a missing tag.',
        );
      return edge;
    });
    const assignments = rows(input, 'assignments', 500_000).map((value) => {
      const row = object(value);
      const songId = id(row.songId),
        tagId = id(row.tagId);
      if (
        !songIDs.has(songId) ||
        !tagIDs.has(tagId) ||
        !['manual', 'artist'].includes(String(row.origin))
      )
        throw new AppError(400, 'Invalid library assignment.');
      return { songId, tagId, origin: row.origin as Assignment['origin'] };
    });
    const unique = <T>(values: T[], key: (value: T) => string) => [
      ...new Map(values.map((value) => [key(value), value])).values(),
    ];
    const next = (value: unknown, ids: Set<number>) => {
      let minimum = 1;
      for (const value of ids) minimum = Math.max(minimum, value + 1);
      if (!Number.isSafeInteger(minimum))
        throw new AppError(400, 'Library identifiers are out of range.');
      if (value === undefined) return minimum;
      const result = id(value);
      if (result < minimum)
        throw new AppError(400, 'Invalid library identifier counter.');
      return result;
    };
    this.data = {
      version: 1,
      songs,
      tags,
      edges: unique(edges, (edge) => `${edge.parentId}:${edge.childId}`),
      assignments: unique(
        assignments,
        (row) => `${row.songId}:${row.tagId}:${row.origin}`,
      ),
      nextSongId: next(input.nextSongId, songIDs),
      nextTagId: next(input.nextTagId, tagIDs),
    };
    this.assertAcyclic();
  }
  snapshot(): LibraryData {
    return structuredClone(this.data);
  }
  exportLibrary() {
    return {
      version: 1,
      ...this.library(),
      assignments: structuredClone(this.data.assignments),
    };
  }
  private tag(tagId: number) {
    const tag = this.data.tags.find((tag) => tag.id === tagId);
    if (!tag) throw new AppError(404, 'Tag not found.');
    return tag;
  }
  song(songId: number) {
    const song = this.data.songs.find((song) => song.id === songId);
    if (!song) throw new AppError(404, 'Song not found.');
    return structuredClone(song);
  }
  findByVideoId(videoId: string) {
    const song = this.data.songs.find((song) => song.videoId === videoId);
    return song ? structuredClone(song) : undefined;
  }
  private adjacency() {
    const result = new Map<number, number[]>();
    for (const edge of this.data.edges) {
      const children = result.get(edge.parentId) ?? [];
      children.push(edge.childId);
      result.set(edge.parentId, children);
    }
    return result;
  }
  private descendants(root: number, adjacency = this.adjacency()) {
    const found = new Set<number>(),
      pending = [root];
    while (pending.length) {
      const current = pending.pop()!;
      if (found.has(current)) continue;
      found.add(current);
      pending.push(...(adjacency.get(current) ?? []));
    }
    return found;
  }
  private assertAcyclic() {
    const degree = new Map(this.data.tags.map((tag) => [tag.id, 0]));
    for (const edge of this.data.edges)
      degree.set(edge.childId, degree.get(edge.childId)! + 1);
    const pending = [...degree]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    const children = this.adjacency();
    let visited = 0;
    while (pending.length) {
      const current = pending.pop()!;
      visited++;
      for (const child of children.get(current) ?? []) {
        const count = degree.get(child)! - 1;
        degree.set(child, count);
        if (count === 0) pending.push(child);
      }
    }
    if (visited !== degree.size)
      throw new AppError(409, 'This relationship would create a tag cycle.');
  }
  private members() {
    const members = new Map(
      this.data.tags.map((tag) => [tag.id, new Set<number>()]),
    );
    const parents = new Map<number, number[]>(),
      remaining = new Map(this.data.tags.map((tag) => [tag.id, 0]));
    for (const row of this.data.assignments)
      members.get(row.tagId)!.add(row.songId);
    for (const edge of this.data.edges) {
      const values = parents.get(edge.childId) ?? [];
      values.push(edge.parentId);
      parents.set(edge.childId, values);
      remaining.set(edge.parentId, remaining.get(edge.parentId)! + 1);
    }
    const pending = [...remaining]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    while (pending.length) {
      const child = pending.pop()!;
      for (const parent of parents.get(child) ?? []) {
        for (const song of members.get(child)!) members.get(parent)!.add(song);
        const count = remaining.get(parent)! - 1;
        remaining.set(parent, count);
        if (count === 0) pending.push(parent);
      }
    }
    return members;
  }
  songs(tagId?: number): Song[] {
    if (tagId === undefined)
      return structuredClone(this.data.songs).sort(order);
    this.tag(tagId);
    const ids = this.members().get(tagId)!;
    return structuredClone(
      this.data.songs.filter((song) => ids.has(song.id)),
    ).sort(order);
  }
  tags() {
    const members = this.members();
    return this.data.tags
      .map((tag) => {
        const songCount = members.get(tag.id)!.size;
        return { ...tag, songCount };
      })
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
          a.id - b.id,
      );
  }
  library(): Library {
    return {
      songs: this.songs(),
      tags: this.tags(),
      edges: structuredClone(this.data.edges),
    };
  }
  details(songId: number): SongDetails {
    const song = this.song(songId),
      memberships = new Map<number, SongMembership>();
    const member = (tagId: number) => {
      if (!memberships.has(tagId))
        memberships.set(tagId, {
          tagId,
          manual: false,
          artist: false,
          inheritedVia: [],
        });
      return memberships.get(tagId)!;
    };
    const assigned = this.data.assignments.filter(
      (row) => row.songId === songId,
    );
    for (const row of assigned) member(row.tagId)[row.origin] = true;
    const members = this.members();
    for (const edge of this.data.edges) {
      if (members.get(edge.childId)!.has(songId))
        member(edge.parentId).inheritedVia.push(edge.childId);
    }
    return { ...song, memberships: [...memberships.values()] };
  }
  private takeID(kind: 'nextSongId' | 'nextTagId') {
    const value = this.data[kind];
    if (!Number.isSafeInteger(value + 1))
      throw new AppError(400, 'Library identifiers are out of range.');
    this.data[kind]++;
    return value;
  }
  private ensureTag(name: string) {
    const existing = this.data.tags.find(
      (tag) => tag.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) return existing.id;
    const id = this.takeID('nextTagId');
    this.data.tags.push({ id, name, pinned: false });
    return id;
  }
  createTag(body: unknown) {
    const name = text(object(body).name, 'Tag name');
    if (
      this.data.tags.some(
        (tag) => tag.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new AppError(409, 'A tag with that name already exists.');
    return this.ensureTag(name);
  }
  updateTag(tagId: number, body: unknown) {
    const tag = this.tag(tagId),
      input = object(body);
    if (input.name === undefined && input.pinned === undefined)
      throw new AppError(400, 'Provide a name or pin state.');
    const name =
      input.name === undefined ? tag.name : text(input.name, 'Tag name');
    if (
      this.data.tags.some(
        (other) =>
          other.id !== tagId && other.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new AppError(409, 'A tag with that name already exists.');
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean')
      throw new AppError(400, 'Pin state must be a boolean.');
    tag.name = name;
    if (typeof input.pinned === 'boolean') tag.pinned = input.pinned;
  }
  deleteTag(tagId: number) {
    this.tag(tagId);
    this.data.tags = this.data.tags.filter((tag) => tag.id !== tagId);
    this.data.assignments = this.data.assignments.filter(
      (row) => row.tagId !== tagId,
    );
    this.data.edges = this.data.edges.filter(
      (edge) => edge.parentId !== tagId && edge.childId !== tagId,
    );
  }
  saveSong(body: unknown, songId?: number) {
    const input = object(body),
      video = videoId(input.url),
      title = text(input.title, 'Title', 500),
      artists = artistNames(input.artists);
    const previous = songId === undefined ? undefined : this.song(songId);
    const duplicate = this.data.songs.find(
      (song) => song.videoId === video && song.id !== songId,
    );
    if (duplicate)
      throw new AppError(
        409,
        'This song is already in your library.',
        duplicate.id,
      );
    const result = songId ?? this.takeID('nextSongId');
    this.data.songs = this.data.songs.filter((song) => song.id !== result);
    this.data.songs.push({ id: result, videoId: video, title, artists });
    if (
      !previous ||
      JSON.stringify(previous.artists) !== JSON.stringify(artists)
    ) {
      this.data.assignments = this.data.assignments.filter(
        (row) => row.songId !== result || row.origin !== 'artist',
      );
      for (const artist of artists)
        this.data.assignments.push({
          songId: result,
          tagId: this.ensureTag(artist),
          origin: 'artist',
        });
    }
    return result;
  }
  deleteSong(songId: number) {
    this.song(songId);
    this.data.songs = this.data.songs.filter((song) => song.id !== songId);
    this.data.assignments = this.data.assignments.filter(
      (row) => row.songId !== songId,
    );
  }
  assign(songId: number, tagId: number, add: boolean) {
    this.song(songId);
    this.tag(tagId);
    this.data.assignments = this.data.assignments.filter(
      (row) =>
        row.songId !== songId || row.tagId !== tagId || row.origin !== 'manual',
    );
    if (add) this.data.assignments.push({ songId, tagId, origin: 'manual' });
  }
  relate(parentId: number, childId: number, add: boolean) {
    this.tag(parentId);
    this.tag(childId);
    if (add && this.descendants(childId).has(parentId))
      throw new AppError(409, 'This relationship would create a tag cycle.');
    this.data.edges = this.data.edges.filter(
      (edge) => edge.parentId !== parentId || edge.childId !== childId,
    );
    if (add) this.data.edges.push({ parentId, childId });
  }
  importPlaylist(playlist: CatalogPlaylist, tagName?: string) {
    if (!playlist.tracks.length)
      throw new AppError(422, 'This playlist has no importable songs.');
    const tagId = this.ensureTag(text(tagName ?? playlist.title, 'Tag name'));
    let imported = 0,
      existing = 0;
    for (const track of playlist.tracks) {
      const previous = this.findByVideoId(track.videoId);
      const songId =
        previous?.id ??
        this.saveSong({
          ...track,
          url: `https://music.youtube.com/watch?v=${track.videoId}`,
        });
      this.assign(songId, tagId, true);
      if (previous) existing++;
      else imported++;
    }
    return { tagId, imported, existing, skipped: playlist.skipped };
  }
  merge(value: unknown) {
    const incoming = new PortableLibrary(value).snapshot();
    const songs = new Map<number, number>(),
      tags = new Map<number, number>(),
      existing = new Set<number>();
    for (const track of incoming.songs) {
      const previous = this.findByVideoId(track.videoId);
      if (previous) {
        songs.set(track.id, previous.id);
        existing.add(previous.id);
      } else {
        const id = this.takeID('nextSongId');
        songs.set(track.id, id);
        this.data.songs.push({ ...track, id });
      }
    }
    for (const tag of incoming.tags) {
      const previous = this.data.tags.find(
        (other) => other.name.toLowerCase() === tag.name.toLowerCase(),
      );
      const id = previous?.id ?? this.ensureTag(tag.name);
      tags.set(tag.id, id);
      if (!previous) this.tag(id).pinned = tag.pinned;
    }
    for (const row of incoming.assignments) {
      const songId = songs.get(row.songId)!,
        tagId = tags.get(row.tagId)!;
      if (row.origin === 'artist' && existing.has(songId)) continue;
      if (
        !this.data.assignments.some(
          (other) =>
            other.songId === songId &&
            other.tagId === tagId &&
            other.origin === row.origin,
        )
      )
        this.data.assignments.push({ songId, tagId, origin: row.origin });
    }
    for (const edge of incoming.edges)
      this.relate(tags.get(edge.parentId)!, tags.get(edge.childId)!, true);
    return {
      imported: incoming.songs.length - existing.size,
      existing: existing.size,
    };
  }
}
