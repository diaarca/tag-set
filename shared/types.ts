export interface Tag {
  id: number;
  name: string;
  pinned: boolean;
  songCount: number;
}
export interface Song {
  id: number;
  videoId: string;
  title: string;
  artists: string[];
}
export interface TagEdge {
  parentId: number;
  childId: number;
}
export interface Library {
  songs: Song[];
  tags: Tag[];
  edges: TagEdge[];
}
export interface SongMembership {
  tagId: number;
  manual: boolean;
  artist: boolean;
  inheritedVia: number[];
}
export interface SongDetails extends Song {
  memberships: SongMembership[];
}
export interface SongInput {
  url: string;
  title: string;
  artists: string[];
}

export interface CatalogSong {
  videoId: string;
  title: string;
  artists: string[];
}
export interface CatalogPlaylist {
  title: string;
  tracks: CatalogSong[];
  skipped: number;
}
export interface PlaylistImportResult {
  tagId: number;
  imported: number;
  existing: number;
  skipped: number;
}
