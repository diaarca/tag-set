import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translate } from '../wrapper/src/i18n';
import '../wrapper/protocol.js';

test('language selection translates labels and notices without translating song metadata', () => {
  assert.equal(translate('en', 'Settings'), 'Settings');
  assert.equal(translate('fr', 'Settings'), 'Paramètres');
  assert.equal(translate('fr', 'Play {0}', 'Settings'), 'Lire Settings');
  assert.equal(
    translate(
      'fr',
      'Library imported: 2 new songs; 3 existing songs preserved.',
    ),
    'Bibliothèque importée : 2 nouveaux morceaux ; 3 morceaux existants conservés.',
  );
  assert.equal(translate('fr', 'An external error'), 'An external error');
  assert.equal(
    globalThis.tagsetProtocol.validatePreferences({
      version: 1,
      normalizeVolume: false,
    }).language,
    'en',
  );
  assert.throws(
    () =>
      globalThis.tagsetProtocol.validatePreferences({
        version: 1,
        normalizeVolume: false,
        language: 'unknown',
      }),
    /language/,
  );
});
