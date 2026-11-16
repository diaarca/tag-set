export type WrapperCommand =
  | { type: 'load'; videoId: string; token?: string }
  | { type: 'play' | 'pause' }
  | { type: 'seek' | 'volume'; value: number }
  | {
      type: 'layout';
      x: number;
      y: number;
      width: number;
      height: number;
      visible: boolean;
    };
declare global {
  var tagsetProtocol: {
    validateCommand(value: unknown): WrapperCommand;
    allowedNavigation(value: string): boolean;
    artworkURL(value: unknown): string | null;
  };
}
