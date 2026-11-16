import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CatalogSong, CatalogPlaylist } from '../shared/types.js';
import { AppError } from './errors.js';
import { artistNames, object, text } from './validation.js';

export interface MusicCatalog {
  search(query: string): Promise<CatalogSong[]>;
  lookup(videoId: string): Promise<CatalogSong>;
  playlist(playlistId: string): Promise<CatalogPlaylist>;
}

export function catalogSong(value: unknown): CatalogSong {
  try {
    const track = object(value);
    if (typeof track.videoId !== 'string' || !/^[\w-]{11}$/.test(track.videoId))
      throw new Error('Invalid video ID');
    return {
      videoId: track.videoId,
      title: text(track.title, 'Title', 500),
      artists: artistNames(track.artists),
    };
  } catch {
    throw new AppError(
      502,
      'The music catalog did not return a title and artist credits. You can enter them manually.',
    );
  }
}

export class YouTubeMusicCatalog implements MusicCatalog {
  private run(request: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const child = execFile(
        process.env.SETWISE_PYTHON ?? 'python3',
        [fileURLToPath(new URL('./catalog.py', import.meta.url))],
        {
          timeout:
            'operation' in request && request.operation === 'playlist'
              ? 120_000
              : 30_000,
          maxBuffer: 16_777_216,
        },
        (error, stdout, stderr) => {
          if (error) {
            const missing =
              ('code' in error && error.code === 'ENOENT') ||
              stderr.includes("No module named 'ytmusicapi'");
            reject(
              new AppError(
                503,
                missing
                  ? 'Music catalog tools are missing. Start the app inside nix develop.'
                  : 'YouTube Music could not return this information. Check the link is public, or try again later.',
              ),
            );
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(
              new AppError(
                502,
                'The music catalog returned an unreadable response.',
              ),
            );
          }
        },
      );
      child.stdin?.on('error', () =>
        reject(
          new AppError(
            503,
            'Could not reach the music catalog tools. Start the app inside nix develop.',
          ),
        ),
      );
      child.stdin?.end(JSON.stringify(request));
    });
  }
  async search(query: string) {
    const response = await this.run({ operation: 'search', query });
    if (!Array.isArray(response))
      throw new AppError(
        502,
        'The music catalog returned an invalid search response.',
      );
    const songs = response.slice(0, 20).map(catalogSong);
    return [...new Map(songs.map((song) => [song.videoId, song])).values()];
  }
  async lookup(videoId: string) {
    return catalogSong(await this.run({ operation: 'lookup', videoId }));
  }
  async playlist(playlistId: string): Promise<CatalogPlaylist> {
    const response = object(
      await this.run({ operation: 'playlist', playlistId }),
    );
    if (
      !Array.isArray(response.tracks) ||
      !Number.isSafeInteger(response.skipped) ||
      Number(response.skipped) < 0
    )
      throw new AppError(502, 'The catalog returned an invalid playlist.');
    return {
      title: text(response.title, 'Playlist title'),
      tracks: [
        ...new Map(
          response.tracks.map(catalogSong).map((song) => [song.videoId, song]),
        ).values(),
      ],
      skipped: Number(response.skipped),
    };
  }
}
