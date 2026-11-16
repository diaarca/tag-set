export const maxLibraryBytes: number;
export function libraryText(value: unknown): string;
export function atomicWrite(filename: string, data: string): Promise<void>;
export function createLibraryStorage(filename: string): {
  read(): Promise<string | null>;
  write(data: string, previous: string | null): Promise<void>;
};
