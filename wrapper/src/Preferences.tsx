import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Preferences } from '../protocol.js';
import '../protocol.js';
import { request } from './host.js';

const validate = globalThis.tagsetProtocol.validatePreferences;
const Context = createContext<{
  preferences: Preferences;
  busy: boolean;
  error: string;
  save(value: Preferences): Promise<void>;
} | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => validate(null));
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void request('readPreferences')
      .then((raw) => {
        const value = validate(raw === null ? null : JSON.parse(String(raw)));
        if (!cancelled) {
          setPreferences(value);
          setLoaded(true);
        }
      })
      .catch((error: Error) => {
        if (!cancelled) setError(error.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const save = async (value: Preferences) => {
    if (!loaded || busy) return;
    setBusy(true);
    setError('');
    try {
      const next = validate(value);
      await request('writePreferences', JSON.stringify(next));
      setPreferences(next);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Settings could not be saved.',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={{ preferences, busy: busy || !loaded, error, save }}
    >
      {children}
    </Context.Provider>
  );
}

export function usePreferences() {
  const value = useContext(Context);
  if (!value) throw new Error('Settings provider is unavailable.');
  return value;
}
