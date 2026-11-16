import { AppError } from '../shared/errors.js';

type Transport = (
  path: string,
  method: string,
  body?: unknown,
) => Promise<unknown>;
let localTransport: Transport | undefined;
export function setApiTransport(transport: Transport) {
  localTransport = transport;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public songId?: number,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  if (localTransport) {
    try {
      return (await localTransport(path, method, body)) as T;
    } catch (error) {
      if (error instanceof AppError)
        throw new ApiError(error.message, error.songId);
      throw error;
    }
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = (await response.json()) as {
      message?: string;
      songId?: number;
    };
    throw new ApiError(error.message ?? 'The request failed.', error.songId);
  }
  return response.status === 204
    ? (undefined as T)
    : (response.json() as Promise<T>);
}
