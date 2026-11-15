import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CatalogSong } from '../shared/types.js';
import { AppError } from './errors.js';
import { artistNames, object, text } from './validation.js';

export interface MusicCatalog {
  search(query: string): Promise<CatalogSong[]>;
  lookup(videoId: string): Promise<CatalogSong>;
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
        { timeout: 30_000, maxBuffer: 1_048_576 },
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
                  : 'YouTube Music could not return song information. Try again, or enter the details manually.',
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
}
