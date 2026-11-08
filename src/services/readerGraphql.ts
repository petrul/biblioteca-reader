import { trackedFetch } from './serversideApi';

export type ReaderStatePayload = {
  revision: number;
  lastSearch?: Record<string, unknown> | null;
  workspace?: Record<string, unknown> | null;
  updatedAt: string;
};

type GraphQlResponse<T> = { data?: T; errors?: Array<{ message?: string }> };

export async function readerGraphql<T>(operationName: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await trackedFetch('/api/reader-graphql', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const body = await response.json() as GraphQlResponse<T>;
  if (!response.ok) throw new Error((body as { error?: string }).error || `reader GraphQL request failed (${response.status})`);
  if (body.errors?.length) throw new Error(body.errors.map(error => error.message || 'GraphQL error').join('; '));
  if (!body.data) throw new Error('reader GraphQL response contained no data');
  return body.data;
}

export function fetchReaderState(): Promise<ReaderStatePayload> {
  return readerGraphql<{ myReaderState: ReaderStatePayload }>('MyReaderState',
    'query MyReaderState { myReaderState { revision lastSearch workspace updatedAt } }')
    .then(result => result.myReaderState);
}

export function updateReaderState(expectedRevision: number, lastSearch: Record<string, unknown> | null, workspace: Record<string, unknown> | null): Promise<ReaderStatePayload> {
  return readerGraphql<{ updateMyReaderState: ReaderStatePayload }>('UpdateMyReaderState',
    'mutation UpdateMyReaderState($expectedRevision: Long!, $lastSearch: JSON, $workspace: JSON) { updateMyReaderState(expectedRevision: $expectedRevision, lastSearch: $lastSearch, workspace: $workspace) { revision lastSearch workspace updatedAt } }',
    { expectedRevision, lastSearch, workspace })
    .then(result => result.updateMyReaderState);
}
