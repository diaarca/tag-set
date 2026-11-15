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
