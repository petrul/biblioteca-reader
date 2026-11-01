import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import {
  currentInitiator, guestLabel, INITIATOR_HEADER, prefixLines, propagateInitiator, receivedLabel, requestInitiator, runAs,
} from './initiator';

test('a guest label is human-readable and stable for its seed', () => {
  const label = guestLabel('visitor-1');
  assert.match(label, /^guest-[a-z]+-[a-z]+-[0-9a-f]{4}$/);
  assert.equal(guestLabel('visitor-1'), label);
  assert.notEqual(guestLabel('visitor-2'), label);
  // biblioteca-server's Initiator.java derives the same label from the same seed
  assert.equal(guestLabel('visitor-1'), 'guest-witty-owl-38c6');
});

test('only a guest label or a user name passes as a received label', () => {
  assert.equal(receivedLabel('petru@scriptorium.ro'), 'petru@scriptorium.ro');
  assert.equal(receivedLabel('guest-amber-otter-3f2a'), 'guest-amber-otter-3f2a');
  assert.equal(receivedLabel(['guest-amber-otter-3f2a']), 'guest-amber-otter-3f2a');
  assert.equal(receivedLabel('petru'), 'petru', 'the seeded admin has a plain name');
  for (const forged of ['system', 'petru@scriptorium.ro) (admin', 'a\nFAKE LINE', '', undefined, null]) {
    assert.equal(receivedLabel(forged), undefined, String(forged));
  }
});

test('work outside a request is the system\'s; inside, its initiator\'s - across awaits', async () => {
  assert.equal(currentInitiator(), 'system');
  await runAs('petru@scriptorium.ro', async () => {
    await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(currentInitiator(), 'petru@scriptorium.ro');
  });
  assert.equal(currentInitiator(), 'system');
});

function capture(): { stream: Writable; lines: () => string } {
  const chunks: string[] = [];
  const stream = new Writable({ write(chunk, _encoding, done) { chunks.push(chunk.toString()); done(); } });
  prefixLines(stream);
  return { stream, lines: () => chunks.join('') };
}

test('every line written starts with its initiator, whatever the chunking', () => {
  const { stream, lines } = capture();
  stream.write('started\n');
  runAs('petru@scriptorium.ro', () => {
    stream.write('GET /api/divs\nError: boom\n    at frame');
    stream.write(' (continued)\n');
    stream.write(Buffer.from('as bytes\n'));
  });
  assert.equal(lines(), [
    '(system) started',
    '(petru@scriptorium.ro) GET /api/divs',
    '(petru@scriptorium.ro) Error: boom',
    '(petru@scriptorium.ro)     at frame (continued)',
    '(petru@scriptorium.ro) as bytes',
    '',
  ].join('\n'));
});

test('calls to Biblioteca services carry the initiator - system outside a request; other hosts never see it', async () => {
  const seen: Array<[string, string | null]> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    seen.push([request.url, request.headers.get(INITIATOR_HEADER)]);
    return new Response('{}', { headers: { [INITIATOR_HEADER]: 'petru@scriptorium.ro' } });
  }) as typeof fetch;
  const answered: string[] = [];
  try {
    propagateInitiator(['http://server.test:8080'], (_request, response) => answered.push(response.headers.get(INITIATOR_HEADER)!));
    await fetch('http://server.test:8080/api/info');
    await runAs('guest-amber-otter-3f2a', async () => {
      await fetch('http://server.test:8080/api/works', { headers: { Accept: 'application/json' } });
      await fetch('https://accounts.example.com/token');
    });
  } finally {
    globalThis.fetch = original;
  }
  assert.deepEqual(seen, [
    ['http://server.test:8080/api/info', 'system'],
    ['http://server.test:8080/api/works', 'guest-amber-otter-3f2a'],
    ['https://accounts.example.com/token', null],
  ]);
  assert.deepEqual(answered, ['petru@scriptorium.ro', 'petru@scriptorium.ro'], 'both service answers, none from the other host');
});

test('an internal service runs a request as its caller says - its own background work as system', () => {
  assert.equal(requestInitiator('petru@scriptorium.ro', 'seed'), 'petru@scriptorium.ro');
  assert.equal(requestInitiator('system', 'seed'), 'system');
  assert.equal(requestInitiator(undefined, '10.0.0.1|curl'), guestLabel('10.0.0.1|curl'));
  assert.equal(requestInitiator('a\nFAKE LINE', '10.0.0.1|curl'), guestLabel('10.0.0.1|curl'));
});
