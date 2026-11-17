export const maxLibraryBytes: number;
export function createPreferencesStorage(filename: string): {
  read(): Promise<string | null>;
  write(value: unknown): Promise<void>;
};
export function libraryText(value: unknown): string;
export function atomicWrite(filename: string, data: string): Promise<void>;
export function createLibraryStorage(filename: string): {
  read(): Promise<string | null>;
  write(data: string, previous: string | null): Promise<void>;
};
export function createLibraryLocationStorage(
  defaultFilename: string,
  configFilename: string,
): {
  read(): Promise<string | null>;
  write(data: string, previous: string | null): Promise<void>;
  location(): Promise<{ path: string; isDefault: boolean }>;
  prepare(
    folder: string | null,
  ): Promise<{ token: string; path: string; data: string | null }>;
  cancel(): Promise<void>;
  activate(
    token: string,
    data: string | null,
    previous: string | null,
  ): Promise<string>;
};
