// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configureApi } from '@gocodealone/workflow-ui/api';
import { apiGet, apiPost, apiPatch, apiDelete } from './api';

describe('api utilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.removeItem('auth_token');
    configureApi({ baseUrl: '/api' });
  });

  describe('apiGet', () => {
    it('calls fetch with GET method and correct URL', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: '1' }), { status: 200 }),
      );
      const result = await apiGet('/test');
      expect(fetch).toHaveBeenCalledWith('/api/test', {
        headers: { 'Content-Type': 'application/json' },
      });
      expect(result).toEqual({ id: '1' });
    });
  });

  describe('apiPost', () => {
    it('calls fetch with POST method and JSON body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      const result = await apiPost('/items', { name: 'test' });
      expect(fetch).toHaveBeenCalledWith('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      });
      expect(result).toEqual({ ok: true });
    });

    it('sends no body when body is undefined', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      await apiPost('/items');
      expect(fetch).toHaveBeenCalledWith('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      });
    });
  });

  describe('apiPatch', () => {
    it('calls fetch with PATCH method and body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ updated: true }), { status: 200 }),
      );
      const result = await apiPatch('/items/1', { name: 'updated' });
      expect(fetch).toHaveBeenCalledWith('/api/items/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'updated' }),
      });
      expect(result).toEqual({ updated: true });
    });
  });

  describe('apiDelete', () => {
    it('calls fetch with DELETE method', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      await apiDelete('/items/1');
      expect(fetch).toHaveBeenCalledWith('/api/items/1', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('auth headers', () => {
    it('includes Authorization header when token exists', async () => {
      localStorage.setItem('auth_token', 'test-token-123');
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: '1' }), { status: 200 }),
      );
      await apiGet('/secure');
      expect(fetch).toHaveBeenCalledWith('/api/secure', {
        headers: {
          Authorization: 'Bearer test-token-123',
          'Content-Type': 'application/json',
        },
      });
    });

    it('omits Authorization header when no token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ id: '1' }), { status: 200 }),
      );
      await apiGet('/public');
      expect(fetch).toHaveBeenCalledWith('/api/public', {
        headers: { 'Content-Type': 'application/json' },
      });
    });
  });

  describe('error handling', () => {
    it('throws error with status code on non-ok response', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('resource not found', { status: 404 }),
      );
      await expect(apiGet('/missing')).rejects.toThrow('HTTP 404: resource not found');
    });
  });

  describe('empty response', () => {
    it('returns undefined for empty response body', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(null, { status: 200 }),
      );
      const result = await apiDelete('/items/1');
      expect(result).toBeUndefined();
    });
  });
});
