import { useEffect, useState } from 'react';
import { send, subscribe } from './host';
import { useTranslation } from './Preferences';

export function SleepTimer() {
  const { t } = useTranslation();
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const unsubscribe = subscribe((message) => {
      if (message.type !== 'sleep-timer') return;
      setDeadline(message.expiresAt);
      setNow(Date.now());
    });
    const synchronize = () => {
      if (!document.hidden) send({ type: 'playback-state' });
    };
    send({ type: 'playback-state' });
    document.addEventListener('visibilitychange', synchronize);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', synchronize);
    };
  }, []);
  useEffect(() => {
    if (deadline === null) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [deadline]);
  const remaining = Math.max(0, Math.ceil(((deadline ?? now) - now) / 1000));
  return (
    <div className="sleep-timer">
      <label>
        {t('Sleep timer')}
        <select
          aria-label={t('Sleep timer')}
          value={deadline === null ? '0' : 'active'}
          onChange={(event) =>
            send({ type: 'sleep-timer', minutes: Number(event.target.value) })
          }
        >
          <option value="0">{t('Off')}</option>
          {deadline !== null && (
            <option value="active" disabled>
              {t(
                'Pause in {0}',
                `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`,
              )}
            </option>
          )}
          {[1, 5, 15, 30, 45, 60, 90, 120].map((minutes) => (
            <option key={minutes} value={minutes}>
              {t('{0} min', minutes)}
            </option>
          ))}
        </select>
      </label>
      {deadline !== null && (
        <button
          type="button"
          onClick={() => send({ type: 'sleep-timer', minutes: 0 })}
        >
          {t('Cancel timer')}
        </button>
      )}
    </div>
  );
}
