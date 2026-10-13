import createClient from 'openapi-fetch';
import type { paths } from '../generated/same-origin-api';
import { trackedFetch } from './serversideApi';

export interface WorkCoverRequest {
  workId: string;
  title: string;
  author: string;
  coverArtUrl?: string;
  subtitle?: string;
  date?: string;
}

const api = createClient<paths>({
  baseUrl: (globalThis as { location?: Location }).location?.origin ?? 'http://localhost',
  fetch: trackedFetch,
});

/** Render a work cover through the reader's same-origin Express gateway. */
export async function generateWorkCover(request: WorkCoverRequest): Promise<Blob> {
  const result = await api.POST('/api/covers/work', {
    body: request,
    parseAs: 'blob',
    // A queued headless-browser render must never leave a card spinning
    // forever. The covers service has its own per-page timeout; this bounds
    // the complete same-origin request, including queue time.
    signal: AbortSignal.timeout(90_000),
  });

  if (result.error || !result.data) {
    const detail = result.error as { error?: string } | undefined;
    throw new Error(detail?.error || `Cover rendering failed (HTTP ${result.response.status})`);
  }
  return result.data as Blob;
}
