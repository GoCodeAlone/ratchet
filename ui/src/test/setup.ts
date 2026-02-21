import '@testing-library/jest-dom';

// Ensure localStorage is available with proper function methods for jsdom.
// Some jsdom versions don't provide localStorage as callable functions.
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.getItem !== 'function') {
  const store: Record<string, string> = {};
  const storage = {
    getItem(key: string): string | null {
      return key in store ? store[key] : null;
    },
    setItem(key: string, value: string): void {
      store[key] = String(value);
    },
    removeItem(key: string): void {
      delete store[key];
    },
    clear(): void {
      Object.keys(store).forEach(k => delete store[k]);
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key(index: number): string | null {
      return Object.keys(store)[index] ?? null;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, writable: true, configurable: true });
}
