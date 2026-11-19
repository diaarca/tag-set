export function createSleepTimer(publish, pause) {
  let expiresAt = null;
  let timer;
  let expired = false;
  const synchronize = () =>
    publish({ type: 'sleep-timer', expiresAt, expired });
  const check = () => {
    if (expiresAt === null || Date.now() < expiresAt) return;
    clearTimeout(timer);
    expiresAt = null;
    expired = true;
    synchronize();
    pause();
  };
  return {
    set(minutes) {
      clearTimeout(timer);
      expiresAt = minutes ? Date.now() + minutes * 60_000 : null;
      expired = false;
      if (expiresAt !== null) timer = setTimeout(check, minutes * 60_000);
      synchronize();
    },
    synchronize() {
      check();
      synchronize();
    },
    get expired() {
      check();
      return expired;
    },
    resume() {
      expired = false;
    },
  };
}
