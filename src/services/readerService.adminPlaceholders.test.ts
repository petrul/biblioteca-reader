import { test } from 'node:test';
import assert from 'node:assert/strict';

// getAdminStatus()'s placeholder shape is the admin drawer's first paint,
// and its own doc comment sets the rule: NEVER a plausible number or an
// invented log - plausible fakes go stale and misreport the deployed
// services (the old '0.9.12-SNAPSHOT' version literal, the 14280-doc
// index seed, and the two made-up 'Ingested 4 TEI files' re-import logs
// all did that). This pins the honest-placeholder contract.

test('admin placeholder carries no plausible numbers and no invented logs', async () => {
  const globals = globalThis as any;
  const previous = { window: globals.window, location: globals.location, localStorage: globals.localStorage };
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) };
  globals.window = { localStorage: storage, location: { origin: 'http://localhost' }, speechSynthesis: { getVoices: () => [] } };
  globals.location = globals.window.location;
  globals.localStorage = storage;
  try {
    const { readerService } = await import('./readerService');
    const placeholder = readerService.getAdminStatus();
    assert.equal(placeholder.luceneIndexStatus.docsIndexed, 0,
      'the pre-fetch paint must show zero docs, not a plausible count');
    assert.deepEqual(placeholder.reimportLogs, [],
      'the pre-fetch paint must show no re-import logs, not invented ones');
    assert.equal(readerService.getRepositories().every(repo => repo.fileCount >= 0), true);
  } finally {
    Object.assign(globals, previous);
  }
});
