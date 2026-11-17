import type { WrapperCommand } from '../protocol.js';

export interface PlaybackMessage {
  type: 'playback';
  videoId: string | null;
  endedVideoId?: string | null;
  loadToken: string | null;
  paused: boolean;
  advertisement: boolean;
  position: number;
  duration: number;
  title: string;
  artwork?: string | null;
}
export type HostMessage =
  | PlaybackMessage
  | {
      type: 'media-action';
      action: 'next' | 'previous';
      loadToken: string | null;
    }
  | { type?: 'error'; error: string };
type Operation =
  | 'readLibrary'
  | 'writeLibrary'
  | 'catalog'
  | 'exportLibrary'
  | 'readPreferences'
  | 'writePreferences'
  | 'hasGitHubToken'
  | 'saveGitHubToken'
  | 'removeGitHubToken'
  | 'githubPull'
  | 'githubPush'
  | 'libraryLocation'
  | 'chooseLibraryFolder'
  | 'defaultLibraryFolder'
  | 'cancelLibraryLocation'
  | 'activateLibraryLocation';
declare global {
  interface Window {
    tagsetHost?: {
      send(command: WrapperCommand): void;
      request(operation: Operation, payload?: unknown): Promise<unknown>;
      onMessage(listener: (message: unknown) => void): () => void;
    };
    webkit?: {
      messageHandlers: {
        wrapperCommand?: { postMessage(message: unknown): void };
      };
    };
    tagsetReceive?: (message: unknown) => void;
  }
}
const listeners = new Set<(message: HostMessage) => void>();
const pending = new Map<
  string,
  { resolve(value: unknown): void; reject(error: Error): void }
>();
let nextToken = 0;
export const uniqueToken = () =>
  globalThis.crypto.randomUUID?.() ?? `${Date.now()}-${++nextToken}`;
function receive(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const message = value as Record<string, unknown>;
  if (message.type === 'response' && typeof message.requestId === 'string') {
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId);
    if (typeof message.error === 'string')
      request.reject(new Error(message.error));
    else request.resolve(message.result);
  } else if (
    message.type === 'playback' ||
    (message.type === 'media-action' &&
      (message.action === 'next' || message.action === 'previous')) ||
    typeof message.error === 'string'
  ) {
    for (const listener of listeners)
      listener(message as unknown as HostMessage);
  }
}
window.tagsetReceive = receive;
window.tagsetHost?.onMessage(receive);

export function subscribe(listener: (message: HostMessage) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function send(command: WrapperCommand) {
  if (window.tagsetHost) window.tagsetHost.send(command);
  else if (window.webkit?.messageHandlers.wrapperCommand)
    window.webkit.messageHandlers.wrapperCommand.postMessage(command);
  else throw new Error('Open TagSet inside its desktop or iPhone wrapper.');
}
export async function request(
  operation: Operation,
  payload?: unknown,
): Promise<unknown> {
  if (window.tagsetHost) return window.tagsetHost.request(operation, payload);
  const bridge = window.webkit?.messageHandlers.wrapperCommand;
  if (!bridge) throw new Error('The native TagSet bridge is unavailable.');
  const requestId = uniqueToken();
  return new Promise((resolve, reject) => {
    const timer =
      operation === 'chooseLibraryFolder'
        ? undefined
        : window.setTimeout(() => {
            pending.delete(requestId);
            reject(
              new Error(
                'The device did not complete this operation. Reopen TagSet before editing again.',
              ),
            );
          }, 120_000);
    pending.set(requestId, {
      resolve(value) {
        window.clearTimeout(timer);
        resolve(value);
      },
      reject(error) {
        window.clearTimeout(timer);
        reject(error);
      },
    });
    try {
      bridge.postMessage({
        type: 'request',
        requestId,
        operation,
        payload: payload ?? null,
      });
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(requestId);
      reject(error);
    }
  });
}
