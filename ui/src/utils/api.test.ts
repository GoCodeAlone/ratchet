import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiGet, apiPost, apiPatch, apiDelete } from './api';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  length: 0,
  key: vi.fn(() => null),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

function mockResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    text: vi.fn().mockResolvedValue(body !== undefined ? JSON.stringify(body) : ''),
  };
}

describe('api utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(store).forEach(k => delete store[k]);
  });

  describe('apiGet', () => {
    it('calls fetch with GET method and correct URL', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: '1' }));
      const result = await apiGet('/test');
      expect(mockFetch).toHaveBeenCalledWith('/api/test', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual({ id: '1' });
    });
  });

  describe('apiPost', () => {
    it('calls fetch with POST method and JSON body', async () => {
      mockFetch.mockResolvedValue(mockResponse({ ok: true }));
      const result = await apiPost('/items', { name: 'test' });
      expect(mockFetch).toHaveBeenCalledWith('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(result).toEqual({ ok: true });
    });

    it('sends no body when body is undefined', async () => {
      mockFetch.mockResolvedValue(mockResponse({ ok: true }));
      await apiPost('/items');
      expect(mockFetch).toHaveBeenCalledWith('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      });
    });
  });

  describe('apiPatch', () => {
    it('calls fetch with PATCH method and body', async () => {
      mockFetch.mockResolvedValue(mockResponse({ updated: true }));
      const result = await apiPatch('/items/1', { name: 'updated' });
      expect(mockFetch).toHaveBeenCalledWith('/api/items/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });
      expect(result).toEqual({ updated: true });
    });
  });

  describe('apiDelete', () => {
    it('calls fetch with DELETE method', async () => {
      mockFetch.mockResolvedValue(mockResponse(undefined));
      await apiDelete('/items/1');
      expect(mockFetch).toHaveBeenCalledWith('/api/items/1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('auth headers', () => {
    it('includes Authorization header when token exists', async () => {
      store['auth_token'] = 'test-token-123';
      mockFetch.mockResolvedValue(mockResponse({ id: '1' }));
      await apiGet('/secure');
      expect(mockFetch).toHaveBeenCalledWith('/api/secure', {
        headers: {
          Authorization: 'Bearer test-token-123',
          'Content-Type': 'application/json',
        },
      });
    });

    it('omits Authorization header when no token', async () => {
      mockFetch.mockResolvedValue(mockResponse({ id: '1' }));
      await apiGet('/public');
      expect(mockFetch).toHaveBeenCalledWith('/api/public', {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('error handling', () => {
    it('throws error with status code on non-ok response', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('resource not found'),
      });
      await expect(apiGet('/missing')).rejects.toThrow('HTTP 404: resource not found');
    });
  });

  describe('empty response', () => {
    it('returns undefined for empty response body', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: vi.fn().mockResolvedValue(''),
      });
      const result = await apiDelete('/items/1');
      expect(result).toBeUndefined();
    });
  });
});
