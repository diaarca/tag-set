import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createPreferencesStorage } from '../wrapper/desktop/storage.mjs';
import '../wrapper/protocol.js';

test('settings persist independently and invalid writes preserve the saved preferences', async () => {
  await mkdir('.build', { recursive: true });
  const folder = await mkdtemp('.build/preferences-');
  try {
    const storage = createPreferencesStorage(join(folder, 'preferences.json'));
    assert.equal(await storage.read(), null);
    const settings = {
      ...globalThis.tagsetProtocol.validatePreferences(null),
      normalizeVolume: true,
    };
    await storage.write(JSON.stringify(settings));
    assert.deepEqual(JSON.parse((await storage.read())!), settings);
    await assert.rejects(storage.write('{broken'));
    await assert.rejects(
      storage.write(JSON.stringify({ version: 1, normalizeVolume: 'yes' })),
    );
    assert.deepEqual(JSON.parse((await storage.read())!), settings);
    assert.equal(
      globalThis.tagsetProtocol.validatePreferences(null).normalizeVolume,
      false,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
