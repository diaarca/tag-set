import Fastify, { type FastifyError } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from './errors.js';
import { LibraryStore } from './database.js';
import { id, object, text, videoId } from './validation.js';
import { YouTubeMusicCatalog, type MusicCatalog } from './catalog.js';

export function createApp(
  store: LibraryStore,
  clientRoot = resolve('dist/client'),
  catalog: MusicCatalog = new YouTubeMusicCatalog(),
) {
  const app = Fastify({ logger: false, bodyLimit: 32_768 });
  app.addHook('onRequest', async (request, reply) => {
    const host = request.headers.host;
    let hostname: string;
    try {
      hostname = new URL(`http://${host}`).hostname;
    } catch {
      throw new AppError(403, 'Invalid host.');
    }
    if (!['localhost', '127.0.0.1', '[::1]'].includes(hostname))
      throw new AppError(403, 'Only local access is allowed.');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header(
      'Content-Security-Policy',
      "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      const origin = request.headers.origin;
      const allowed = new Set([
        `http://${host}`,
        'http://127.0.0.1:5173',
        'http://localhost:5173',
      ]);
      if (origin && !allowed.has(origin))
        throw new AppError(403, 'Requests must originate from the local app.');
      if (request.headers['sec-fetch-site'] === 'cross-site')
        throw new AppError(403, 'Cross-site mutations are not allowed.');
    }
  });
  app.setErrorHandler<FastifyError>((error, _request, reply) => {
    if (error instanceof AppError)
      return reply
        .code(error.statusCode)
        .send({ message: error.message, songId: error.songId });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)
      return reply.code(error.statusCode).send({ message: error.message });
    console.error(error);
    return reply
      .code(500)
      .send({ message: 'The library could not complete this operation.' });
  });
  app.get('/api/library', async () => store.library());
  app.get<{ Querystring: { q?: string } }>(
    '/api/catalog/search',
    async (request) => catalog.search(text(request.query.q, 'Search query')),
  );
  app.post('/api/songs/import', async (request, reply) => {
    const video = videoId(object(request.body).url);
    const existing = store.findByVideoId(video);
    if (existing) return reply.send(store.details(existing.id));
    const track = await catalog.lookup(video);
    if (track.videoId !== video)
      throw new AppError(
        502,
        'YouTube Music returned a different song. Please try searching for the track.',
      );
    return reply.code(201).send(
      store.details(
        store.saveSong({
          url: `https://music.youtube.com/watch?v=${video}`,
          title: track.title,
          artists: track.artists,
        }),
      ),
    );
  });
  app.get<{ Querystring: { tagId?: string } }>('/api/songs', async (request) =>
    store.songs(
      request.query.tagId === undefined ? undefined : id(request.query.tagId),
    ),
  );
  app.get<{ Params: { id: string } }>('/api/songs/:id', async (request) =>
    store.details(id(request.params.id)),
  );
  app.post('/api/songs', async (request, reply) =>
    reply.code(201).send(store.details(store.saveSong(request.body))),
  );
  app.put<{ Params: { id: string } }>('/api/songs/:id', async (request) =>
    store.details(store.saveSong(request.body, id(request.params.id))),
  );
  app.delete<{ Params: { id: string } }>(
    '/api/songs/:id',
    async (request, reply) => {
      store.deleteSong(id(request.params.id));
      return reply.code(204).send();
    },
  );
  app.post('/api/tags', async (request, reply) =>
    reply.code(201).send({ id: store.createTag(request.body) }),
  );
  app.patch<{ Params: { id: string } }>(
    '/api/tags/:id',
    async (request, reply) => {
      store.updateTag(id(request.params.id), request.body);
      return reply.code(204).send();
    },
  );
  app.delete<{ Params: { id: string } }>(
    '/api/tags/:id',
    async (request, reply) => {
      store.deleteTag(id(request.params.id));
      return reply.code(204).send();
    },
  );
  for (const method of ['PUT', 'DELETE'] as const) {
    app.route<{ Params: { songId: string; tagId: string } }>({
      method,
      url: '/api/songs/:songId/tags/:tagId',
      handler: async (request, reply) => {
        store.assign(
          id(request.params.songId),
          id(request.params.tagId),
          method === 'PUT',
        );
        return reply.code(204).send();
      },
    });
    app.route<{ Params: { parentId: string; childId: string } }>({
      method,
      url: '/api/tags/:parentId/children/:childId',
      handler: async (request, reply) => {
        store.relate(
          id(request.params.parentId),
          id(request.params.childId),
          method === 'PUT',
        );
        return reply.code(204).send();
      },
    });
  }
  if (existsSync(clientRoot)) app.register(fastifyStatic, { root: clientRoot });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ message: 'Not found.' }),
  );
  return app;
}
