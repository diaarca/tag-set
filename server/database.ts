import Database from 'better-sqlite3';
import type {
  Library,
  Song,
  SongDetails,
  SongMembership,
  Tag,
  TagEdge,
  CatalogPlaylist,
  PlaylistImportResult,
} from '../shared/types.js';
import { AppError } from './errors.js';
import { artistNames, object, text, videoId } from './validation.js';

const reachable = `WITH RECURSIVE reach(root, descendant) AS (
  SELECT id, id FROM tags
  UNION
  SELECT reach.root, tag_edges.child_id FROM reach JOIN tag_edges ON tag_edges.parent_id = reach.descendant
)`;
interface SongRow {
  id: number;
  videoId: string;
  title: string;
  artists: string;
}
interface TagRow {
  id: number;
  name: string;
  pinned: number;
  songCount: number;
}

export class LibraryStore {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL');
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version > 1)
      throw new Error(
        'This database was created by a newer version of Setwise.',
      );
    if (version === 0)
      this.db.transaction(() => {
        this.db.exec(`
        CREATE TABLE songs (id INTEGER PRIMARY KEY AUTOINCREMENT, video_id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, artists TEXT NOT NULL);
        CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)));
        CREATE TABLE song_tags (
          song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
          tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          origin TEXT NOT NULL CHECK (origin IN ('manual', 'artist')),
          PRIMARY KEY (song_id, tag_id, origin)
        );
        CREATE INDEX song_tags_by_tag ON song_tags(tag_id, song_id);
        CREATE TABLE tag_edges (
          parent_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          child_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          PRIMARY KEY (parent_id, child_id), CHECK (parent_id != child_id)
        );
        CREATE INDEX tag_edges_by_child ON tag_edges(child_id, parent_id);
        PRAGMA user_version = 1;
      `);
      })();
  }
  close() {
    this.db.close();
  }
  requireTag(id: number) {
    if (!this.db.prepare('SELECT id FROM tags WHERE id = ?').get(id))
      throw new AppError(404, 'Tag not found.');
  }
  song(id: number): Song {
    const row = this.db
      .prepare(
        'SELECT id, video_id AS videoId, title, artists FROM songs WHERE id = ?',
      )
      .get(id) as SongRow | undefined;
    if (!row) throw new AppError(404, 'Song not found.');
    return { ...row, artists: JSON.parse(row.artists) as string[] };
  }
  findByVideoId(videoId: string): Song | undefined {
    const row = this.db
      .prepare('SELECT id FROM songs WHERE video_id = ?')
      .get(videoId) as { id: number } | undefined;
    return row ? this.song(row.id) : undefined;
  }
  importPlaylist(
    playlist: CatalogPlaylist,
    tagName?: string,
  ): PlaylistImportResult {
    if (!playlist.tracks.length)
      throw new AppError(422, 'This playlist has no importable songs.');
    return this.db.transaction(() => {
      const tagId = this.ensureTag(text(tagName ?? playlist.title, 'Tag name'));
      let imported = 0;
      let existing = 0;
      for (const track of playlist.tracks) {
        const previous = this.findByVideoId(track.videoId);
        const songId =
          previous?.id ??
          this.saveSong({
            url: `https://music.youtube.com/watch?v=${track.videoId}`,
            title: track.title,
            artists: track.artists,
          });
        this.assign(songId, tagId, true);
        if (previous) existing++;
        else imported++;
      }
      return { tagId, imported, existing, skipped: playlist.skipped };
    })();
  }
  songs(tagId?: number): Song[] {
    if (tagId !== undefined) this.requireTag(tagId);
    const rows = (
      tagId === undefined
        ? this.db
            .prepare(
              'SELECT id, video_id AS videoId, title, artists FROM songs ORDER BY title COLLATE NOCASE, id',
            )
            .all()
        : this.db
            .prepare(
              `${reachable}
          SELECT DISTINCT songs.id, songs.video_id AS videoId, songs.title, songs.artists
          FROM songs JOIN song_tags ON song_tags.song_id = songs.id JOIN reach ON reach.descendant = song_tags.tag_id
          WHERE reach.root = ? ORDER BY songs.title COLLATE NOCASE, songs.id`,
            )
            .all(tagId)
    ) as SongRow[];
    return rows.map((row) => ({
      ...row,
      artists: JSON.parse(row.artists) as string[],
    }));
  }
  tags(): Tag[] {
    const rows = this.db
      .prepare(
        `${reachable}
      SELECT tags.id, tags.name, tags.pinned, COUNT(DISTINCT song_tags.song_id) AS songCount
      FROM tags LEFT JOIN reach ON reach.root = tags.id LEFT JOIN song_tags ON song_tags.tag_id = reach.descendant
      GROUP BY tags.id ORDER BY tags.pinned DESC, tags.name COLLATE NOCASE, tags.id`,
      )
      .all() as TagRow[];
    return rows.map((row) => ({ ...row, pinned: Boolean(row.pinned) }));
  }
  library(): Library {
    return {
      songs: this.songs(),
      tags: this.tags(),
      edges: this.db
        .prepare(
          'SELECT parent_id AS parentId, child_id AS childId FROM tag_edges ORDER BY parent_id, child_id',
        )
        .all() as TagEdge[],
    };
  }
  exportLibrary() {
    return {
      version: 1,
      ...this.library(),
      assignments: this.db
        .prepare(
          'SELECT song_id AS songId, tag_id AS tagId, origin FROM song_tags ORDER BY song_id, tag_id, origin',
        )
        .all(),
    };
  }
  details(id: number): SongDetails {
    const song = this.song(id);
    const direct = this.db
      .prepare(
        'SELECT tag_id AS tagId, origin FROM song_tags WHERE song_id = ?',
      )
      .all(id) as { tagId: number; origin: string }[];
    const memberships = new Map<number, SongMembership>();
    const get = (tagId: number) => {
      if (!memberships.has(tagId))
        memberships.set(tagId, {
          tagId,
          manual: false,
          artist: false,
          inheritedVia: [],
        });
      return memberships.get(tagId)!;
    };
    for (const row of direct) {
      if (row.origin === 'manual') get(row.tagId).manual = true;
      else get(row.tagId).artist = true;
    }
    const paths = this.db
      .prepare(
        `${reachable}
      SELECT DISTINCT tag_edges.parent_id AS tagId, tag_edges.child_id AS childId
      FROM tag_edges JOIN reach ON reach.root = tag_edges.child_id
      JOIN song_tags ON song_tags.tag_id = reach.descendant WHERE song_tags.song_id = ?`,
      )
      .all(id) as { tagId: number; childId: number }[];
    for (const path of paths) get(path.tagId).inheritedVia.push(path.childId);
    return { ...song, memberships: [...memberships.values()] };
  }
  private ensureTag(name: string): number {
    const key = name.toLowerCase();
    this.db
      .prepare(
        'INSERT INTO tags (name, name_key) VALUES (?, ?) ON CONFLICT(name_key) DO NOTHING',
      )
      .run(name, key);
    return (
      this.db.prepare('SELECT id FROM tags WHERE name_key = ?').get(key) as {
        id: number;
      }
    ).id;
  }
  createTag(body: unknown): number {
    const name = text(object(body).name, 'Tag name');
    if (
      this.db
        .prepare('SELECT id FROM tags WHERE name_key = ?')
        .get(name.toLowerCase())
    )
      throw new AppError(409, 'A tag with that name already exists.');
    return this.ensureTag(name);
  }
  updateTag(id: number, body: unknown) {
    this.requireTag(id);
    const input = object(body);
    if (input.name === undefined && input.pinned === undefined)
      throw new AppError(400, 'Provide a name or pin state.');
    this.db.transaction(() => {
      if (input.name !== undefined) {
        const name = text(input.name, 'Tag name');
        if (
          this.db
            .prepare('SELECT id FROM tags WHERE name_key = ? AND id != ?')
            .get(name.toLowerCase(), id)
        )
          throw new AppError(409, 'A tag with that name already exists.');
        this.db
          .prepare('UPDATE tags SET name = ?, name_key = ? WHERE id = ?')
          .run(name, name.toLowerCase(), id);
      }
      if (input.pinned !== undefined) {
        if (typeof input.pinned !== 'boolean')
          throw new AppError(400, 'Pin state must be a boolean.');
        this.db
          .prepare('UPDATE tags SET pinned = ? WHERE id = ?')
          .run(Number(input.pinned), id);
      }
    })();
  }
  deleteTag(id: number) {
    this.requireTag(id);
    this.db.prepare('DELETE FROM tags WHERE id = ?').run(id);
  }
  saveSong(body: unknown, id?: number): number {
    const input = object(body);
    const video = videoId(input.url);
    const title = text(input.title, 'Title', 500);
    const artists = artistNames(input.artists);
    return this.db.transaction(() => {
      const previous = id === undefined ? undefined : this.song(id);
      const duplicate = this.db
        .prepare('SELECT id FROM songs WHERE video_id = ? AND id != ?')
        .get(video, id ?? -1) as { id: number } | undefined;
      if (duplicate)
        throw new AppError(
          409,
          'This song is already in your library.',
          duplicate.id,
        );
      let songId = id;
      if (songId === undefined)
        songId = Number(
          this.db
            .prepare(
              'INSERT INTO songs (video_id, title, artists) VALUES (?, ?, ?)',
            )
            .run(video, title, JSON.stringify(artists)).lastInsertRowid,
        );
      else
        this.db
          .prepare(
            'UPDATE songs SET video_id = ?, title = ?, artists = ? WHERE id = ?',
          )
          .run(video, title, JSON.stringify(artists), songId);
      // Title-only edits must not recreate artist tags that were intentionally deleted.
      if (
        !previous ||
        JSON.stringify(previous.artists) !== JSON.stringify(artists)
      ) {
        this.db
          .prepare(
            "DELETE FROM song_tags WHERE song_id = ? AND origin = 'artist'",
          )
          .run(songId);
        for (const artist of artists)
          this.db
            .prepare(
              "INSERT INTO song_tags (song_id, tag_id, origin) VALUES (?, ?, 'artist') ON CONFLICT DO NOTHING",
            )
            .run(songId, this.ensureTag(artist));
      }
      return songId;
    })();
  }
  deleteSong(id: number) {
    this.song(id);
    this.db.prepare('DELETE FROM songs WHERE id = ?').run(id);
  }
  assign(songId: number, tagId: number, add: boolean) {
    this.song(songId);
    this.requireTag(tagId);
    if (add)
      this.db
        .prepare(
          "INSERT INTO song_tags (song_id, tag_id, origin) VALUES (?, ?, 'manual') ON CONFLICT DO NOTHING",
        )
        .run(songId, tagId);
    else
      this.db
        .prepare(
          "DELETE FROM song_tags WHERE song_id = ? AND tag_id = ? AND origin = 'manual'",
        )
        .run(songId, tagId);
  }
  relate(parentId: number, childId: number, add: boolean) {
    this.db.transaction(() => {
      this.requireTag(parentId);
      this.requireTag(childId);
      if (add) {
        if (
          this.db
            .prepare(
              `${reachable} SELECT 1 FROM reach WHERE root = ? AND descendant = ?`,
            )
            .get(childId, parentId)
        )
          throw new AppError(
            409,
            'This relationship would create a tag cycle.',
          );
        this.db
          .prepare(
            'INSERT INTO tag_edges (parent_id, child_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
          )
          .run(parentId, childId);
      } else
        this.db
          .prepare('DELETE FROM tag_edges WHERE parent_id = ? AND child_id = ?')
          .run(parentId, childId);
    })();
  }
}
