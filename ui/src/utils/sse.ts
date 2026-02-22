import { connectSSE as sharedConnectSSE } from '@gocodealone/workflow-ui/sse';
import type { SSEEvent } from '../types';

export function connectSSE(onEvent: (event: SSEEvent) => void): EventSource {
  return sharedConnectSSE({ onEvent: onEvent as (event: unknown) => void });
}
