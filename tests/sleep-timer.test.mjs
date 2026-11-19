import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSleepTimer } from '../wrapper/desktop/sleep-timer.mjs';

test('sleep timer expires once, supports replacement/cancellation and catches up after sleep', (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const messages = [];
  let pauses = 0;
  const timer = createSleepTimer(
    (message) => messages.push(message),
    () => pauses++,
  );
  timer.set(1);
  assert.equal(messages.at(-1).expiresAt, 61_000);
  t.mock.timers.tick(30_000);
  timer.set(2);
  t.mock.timers.tick(60_000);
  assert.equal(pauses, 0);
  timer.set(0);
  t.mock.timers.tick(120_000);
  assert.equal(pauses, 0);
  assert.equal(messages.at(-1).expiresAt, null);
  timer.set(1);
  t.mock.timers.tick(60_000);
  assert.equal(pauses, 1);
  assert.equal(timer.expired, true);
  assert.deepEqual(messages.at(-1), {
    type: 'sleep-timer',
    expiresAt: null,
    expired: true,
  });
  timer.synchronize();
  assert.equal(pauses, 1);
  timer.resume();
  assert.equal(timer.expired, false);
  timer.set(1);
  // The OS may suspend timers: checking the deadline must still stop playback.
  t.mock.timers.setTime(Date.now() + 120_000);
  timer.synchronize();
  assert.equal(pauses, 2);
  t.mock.timers.tick(60_000);
  assert.equal(pauses, 2);
});
