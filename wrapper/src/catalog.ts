import type { CatalogPlaylist, CatalogSong } from '../../shared/types.js';
import { AppError } from '../../shared/errors.js';
import { artistNames, text } from '../../shared/validation.js';

type Transport = (
  endpoint: 'search' | 'next' | 'browse',
  body: Record<string, unknown>,
) => Promise<unknown>;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const field = (value: unknown, key: string) => record(value)[key];
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
function nodes(key: string, value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap((child) => nodes(key, child));
  const object = record(value),
    found = object[key];
  return [
    ...(found && typeof found === 'object' && !Array.isArray(found)
      ? [record(found)]
      : []),
    ...Object.values(object).flatMap((child) => nodes(key, child)),
  ];
}
const runs = (value: unknown) => array(field(value, 'runs')).map(record);
const label = (value: unknown) =>
  typeof field(value, 'simpleText') === 'string'
    ? String(field(value, 'simpleText'))
    : runs(value)
        .map((run) => (typeof run.text === 'string' ? run.text : ''))
        .join('');
const browseID = (run: unknown) =>
  field(field(field(run, 'navigationEndpoint'), 'browseEndpoint'), 'browseId');

function catalogTracks(value: unknown, panel = false): CatalogSong[] {
  const tracks: CatalogSong[] = [];
  for (const row of nodes(
    panel ? 'playlistPanelVideoRenderer' : 'musicResponsiveListItemRenderer',
    value,
  )) {
    const columns = array(row.flexColumns).map((column) =>
      field(field(column, 'musicResponsiveListItemFlexColumnRenderer'), 'text'),
    );
    const id = panel
      ? row.videoId
      : (field(row.playlistItemData, 'videoId') ??
        field(
          field(
            field(runs(columns[0])[0], 'navigationEndpoint'),
            'watchEndpoint',
          ),
          'videoId',
        ));
    const title = label(panel ? row.title : columns[0]);
    const credits = panel
      ? [...runs(row.longBylineText), ...runs(row.shortBylineText)]
      : columns.slice(1).flatMap(runs);
    const artists = [
      ...new Set(
        credits
          .filter(
            (run) =>
              typeof browseID(run) === 'string' &&
              String(browseID(run)).startsWith('UC'),
          )
          .map((run) => (typeof run.text === 'string' ? run.text.trim() : ''))
          .filter(Boolean),
      ),
    ];
    if (
      typeof id !== 'string' ||
      !/^[\w-]{11}$/.test(id) ||
      !title ||
      !artists.length
    )
      continue;
    tracks.push({
      videoId: id,
      title: text(title, 'Title', 500),
      artists: artistNames(artists),
    });
  }
  return [...new Map(tracks.map((track) => [track.videoId, track])).values()];
}

export class MusicCatalog {
  constructor(private transport: Transport) {}
  async search(query: string) {
    return catalogTracks(
      await this.transport('search', {
        query: text(query, 'Search query'),
        params: 'EgWKAQIIAWoMEA4QChADEAQQCRAF',
      }),
    ).slice(0, 20);
  }
  async lookup(videoId: string) {
    const page = await this.transport('next', { videoId, isAudioOnly: true });
    const track = catalogTracks(page, true).find(
      (track) => track.videoId === videoId,
    );
    if (!track)
      throw new AppError(
        502,
        'YouTube Music did not return this song’s title and artist credits. You can enter them manually.',
      );
    return track;
  }
  async playlist(playlistId: string): Promise<CatalogPlaylist> {
    let page = await this.transport('browse', { browseId: `VL${playlistId}` });
    const header =
      nodes('musicResponsiveHeaderRenderer', page)[0] ??
      nodes('musicDetailHeaderRenderer', page)[0];
    let title = label(header?.title);
    if (!title && playlistId.startsWith('OLA')) {
      for (const row of nodes('musicResponsiveListItemRenderer', page)) {
        const credits = array(row.flexColumns).flatMap((column) =>
          runs(
            field(
              field(column, 'musicResponsiveListItemFlexColumnRenderer'),
              'text',
            ),
          ),
        );
        title = String(
          credits.find(
            (run) =>
              typeof browseID(run) === 'string' &&
              String(browseID(run)).startsWith('MPRE'),
          )?.text ?? '',
        );
        if (title) break;
      }
    }
    if (!title)
      throw new AppError(
        502,
        'The playlist is unavailable or its title could not be read.',
      );
    const tracks = new Map<string, CatalogSong>(),
      tokens = new Set<string>();
    let skipped = 0;
    while (true) {
      const containers = [
        'musicPlaylistShelfRenderer',
        'musicPlaylistShelfContinuation',
        'musicShelfContinuation',
      ].flatMap((key) => nodes(key, page));
      containers.push(
        ...nodes('appendContinuationItemsAction', page).filter(
          (action) =>
            action.targetId === undefined || action.targetId === playlistId,
        ),
      );
      if (!containers.length)
        throw new AppError(
          502,
          'The playlist page could not be read. No songs were imported.',
        );
      for (const container of containers) {
        for (const row of nodes('musicResponsiveListItemRenderer', container)) {
          const track = catalogTracks({
            musicResponsiveListItemRenderer: row,
          })[0];
          if (track) tracks.set(track.videoId, track);
          else skipped++;
        }
      }
      const continuation = containers
        .flatMap((container) => [
          ...nodes('nextContinuationData', container).map(
            (row) => row.continuation,
          ),
          ...nodes('continuationCommand', container).map((row) => row.token),
        ])
        .find((value) => typeof value === 'string');
      if (typeof continuation !== 'string') break;
      if (tokens.has(continuation) || tokens.size >= 1000)
        throw new AppError(
          502,
          'YouTube returned too many or repeating playlist pages. No songs were imported.',
        );
      tokens.add(continuation);
      page = await this.transport('browse', { continuation });
    }
    return {
      title: text(title, 'Playlist title'),
      tracks: [...tracks.values()],
      skipped,
    };
  }
}
