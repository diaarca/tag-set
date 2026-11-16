export function createTrackNavigation(contents: {
  on(
    event: 'will-prevent-unload',
    listener: (event: { preventDefault(): void }) => void,
  ): unknown;
  getURL(): string;
  loadURL(url: string): Promise<unknown>;
}): (videoId: string) => Promise<void>;
