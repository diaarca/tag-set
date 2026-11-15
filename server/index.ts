import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createApp } from './app.js';
import { LibraryStore } from './database.js';

const filename = resolve(process.env.SETWISE_DB ?? 'data/library.sqlite');
mkdirSync(dirname(filename), { recursive: true });
const store = new LibraryStore(filename);
const app = createApp(store);
app.addHook('onClose', async () => store.close());
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  });
try {
  const address = await app.listen({ host: '127.0.0.1', port: 3210 });
  console.log(`Setwise is ready at ${address}`);
} catch (error) {
  console.error(error);
  await app.close();
  process.exitCode = 1;
}
