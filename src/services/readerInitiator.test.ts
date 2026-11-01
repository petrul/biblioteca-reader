import assert from 'node:assert/strict';
import test from 'node:test';
import { guestLabel, INITIATOR_HEADER } from './initiator';
import { createSessionInitiators } from './readerInitiator';

const answer = (label: string, setCookie?: string) => {
  const headers = new Headers({ [INITIATOR_HEADER]: label });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { headers });
};

test('an unknown session is the guest of its seed', () => {
  const sessions = createSessionInitiators();
  assert.equal(sessions.labelFor('JSESSIONID=abc; bib_v=x', 'visitor-1'), guestLabel('visitor-1'));
  assert.equal(sessions.labelFor(undefined, 'visitor-1'), guestLabel('visitor-1'));
});

test('a session is its user once biblioteca-server has said so', () => {
  const sessions = createSessionInitiators();
  sessions.learn('JSESSIONID=abc; bib_v=x', answer('petru@scriptorium.ro'));
  assert.equal(sessions.labelFor('bib_v=x; JSESSIONID=abc', 'visitor-1'), 'petru@scriptorium.ro');
});

test('a sign-in labels the session it starts, not the guest one it replaces', () => {
  const sessions = createSessionInitiators();
  sessions.learn('JSESSIONID=guest-session', answer('petru@scriptorium.ro', 'JSESSIONID=new-session; Path=/; HttpOnly'));
  assert.equal(sessions.labelFor('JSESSIONID=new-session', 'visitor-1'), 'petru@scriptorium.ro');
  assert.equal(sessions.labelFor('JSESSIONID=guest-session', 'visitor-1'), guestLabel('visitor-1'));
});

test('a signed-out session is a guest again; a forged answer changes nothing', () => {
  const sessions = createSessionInitiators();
  sessions.learn('JSESSIONID=abc', answer('petru@scriptorium.ro'));
  sessions.learn('JSESSIONID=abc', answer('petru) (admin'));
  assert.equal(sessions.labelFor('JSESSIONID=abc', 'visitor-1'), 'petru@scriptorium.ro');
  sessions.learn('JSESSIONID=abc', answer('guest-amber-otter-3f2a'));
  assert.equal(sessions.labelFor('JSESSIONID=abc', 'visitor-1'), guestLabel('visitor-1'));
});

test('the oldest sessions are forgotten past the limit', () => {
  const sessions = createSessionInitiators(2);
  for (const id of ['a', 'b', 'c']) sessions.learn(`JSESSIONID=${id}`, answer(`${id}@scriptorium.ro`));
  assert.equal(sessions.labelFor('JSESSIONID=a', 'visitor-1'), guestLabel('visitor-1'));
  assert.equal(sessions.labelFor('JSESSIONID=c', 'visitor-1'), 'c@scriptorium.ro');
});
