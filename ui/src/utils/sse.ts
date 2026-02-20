import { SSEEvent } from '../types';

export function connectSSE(onEvent: (event: SSEEvent) => void): EventSource {
  const token = localStorage.getItem('auth_token');
  const url = token ? `/events?token=${encodeURIComponent(token)}` : '/events';
  const es = new EventSource(url);

  es.onmessage = (e) => {
    try {
      const parsed = JSON.parse(e.data) as SSEEvent;
      onEvent(parsed);
    } catch {
      // ignore malformed events
    }
  };

  es.onerror = () => {
    // EventSource will auto-reconnect on error
  };

  return es;
}
