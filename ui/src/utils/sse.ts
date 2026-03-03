import { connectSSE as sharedConnectSSE } from '@gocodealone/workflow-ui/sse';
import type { SSEEvent } from '../types';

export function connectSSE(onEvent: (event: SSEEvent) => void): EventSource {
  const es = sharedConnectSSE({ onEvent: onEvent as (event: unknown) => void });
  es.onerror = () => {
    // Suppress SSE connection errors in console — the shared library handles reconnection
  };
  return es;
}
