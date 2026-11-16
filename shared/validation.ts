import { AppError } from './errors.js';

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AppError(400, 'Expected a JSON object.');
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw new AppError(400, `${label} must contain 1–${max} characters.`);
  return value.trim();
}
export function id(value: unknown): number {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[1-9]\d*$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw new AppError(400, 'Invalid identifier.');
  return Number(value);
}
export function videoId(value: unknown): string {
  const input = text(value, 'YouTube URL', 2048);
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AppError(
      400,
      'Enter a complete YouTube or YouTube Music song URL.',
    );
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port
  )
    throw new AppError(400, 'Invalid YouTube URL.');
  const host = url.hostname.toLowerCase();
  let video: string | null = null;
  if (host === 'youtu.be') video = url.pathname.slice(1).split('/')[0];
  if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
    ].includes(host)
  ) {
    if (url.pathname === '/watch') video = url.searchParams.get('v');
    else if (/^\/(shorts|embed)\//.test(url.pathname))
      video = url.pathname.split('/')[2];
  }
  if (!video || !/^[\w-]{11}$/.test(video))
    throw new AppError(
      400,
      'That URL does not identify a YouTube song or video.',
    );
  return video;
}
export function artistNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30)
    throw new AppError(400, 'Enter between 1 and 30 artists.');
  const names = value.map((name) => text(name, 'Artist name'));
  return [...new Map(names.map((name) => [name.toLowerCase(), name])).values()];
}

export function playlistId(value: unknown): string {
  let url: URL;
  try {
    url = new URL(text(value, 'Playlist URL', 2048));
  } catch {
    throw new AppError(400, 'Enter a complete YouTube Music playlist URL.');
  }
  const playlist = url.searchParams.get('list');
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    ![
      'youtube.com',
      'www.youtube.com',
      'music.youtube.com',
      'm.youtube.com',
    ].includes(url.hostname) ||
    !['/playlist', '/watch'].includes(url.pathname) ||
    !playlist ||
    !/^[\w-]{10,200}$/.test(playlist)
  ) {
    throw new AppError(
      400,
      'That URL does not identify a YouTube Music playlist.',
    );
  }
  return playlist;
}
