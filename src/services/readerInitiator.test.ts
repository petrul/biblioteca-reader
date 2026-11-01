import assert from 'node:assert/strict';
import test from 'node:test';
import { INITIATOR_HEADER } from './initiator';
import { createSessionInitiators, guestNameOf } from './readerInitiator';

const answer = (label: string, setCookie?: string) => {
  const headers = new Headers({ [INITIATOR_HEADER]: label });
  if (setCookie) headers.append('Set-Cookie', setCookie);
  return new Response(null, { headers });
};

test('an unknown session is its browser\'s guest - else anonymous', () => {
  const sessions = createSessionInitiators();
  assert.equal(sessions.labelFor('JSESSIONID=abc; bib_guest=guest_formidable_dictator'), 'guest_formidable_dictator');
  assert.equal(sessions.labelFor('JSESSIONID=abc'), 'anonymous');
  assert.equal(sessions.labelFor('bib_guest=petru@scriptorium.ro'), 'anonymous', 'a cookie cannot claim an account');
  assert.equal(sessions.labelFor(undefined), 'anonymous');
});

test('a session is its user once biblioteca-server has said so', () => {
  const sessions = createSessionInitiators();
  sessions.learn('JSESSIONID=abc; bib_guest=guest_formidable_dictator', answer('petru@scriptorium.ro'));
  assert.equal(sessions.labelFor('bib_guest=guest_formidable_dictator; JSESSIONID=abc'), 'petru@scriptorium.ro');
});

test('a sign-in labels the session it starts, not the guest one it replaces', () => {
  const sessions = createSessionInitiators();
  sessions.learn('JSESSIONID=guest-session', answer('petru@scriptorium.ro', 'JSESSIONID=new-session; Path=/; HttpOnly'));
  assert.equal(sessions.labelFor('JSESSIONID=new-session'), 'petru@scriptorium.ro');
  assert.equal(sessions.labelFor('JSESSIONID=guest-session; bib_guest=guest_formidable_dictator'), 'guest_formidable_dictator');
});

test('a signed-out session is its guest again; a forged answer changes nothing', () => {
  const sessions = createSessionInitiators();
  const cookies = 'JSESSIONID=abc; bib_guest=guest_formidable_dictator';
  sessions.learn(cookies, answer('petru@scriptorium.ro'));
  sessions.learn(cookies, answer('petru) (admin'));
  assert.equal(sessions.labelFor(cookies), 'petru@scriptorium.ro');
  sessions.learn(cookies, answer('guest_formidable_dictator'));
  assert.equal(sessions.labelFor(cookies), 'guest_formidable_dictator');
  sessions.learn(cookies, answer('petru@scriptorium.ro'));
  sessions.learn(cookies, answer('anonymous'));
  assert.equal(sessions.labelFor(cookies), 'guest_formidable_dictator');
});

test('the oldest sessions are forgotten past the limit', () => {
  const sessions = createSessionInitiators(2);
  for (const id of ['a', 'b', 'c']) sessions.learn(`JSESSIONID=${id}`, answer(`${id}@scriptorium.ro`));
  assert.equal(sessions.labelFor('JSESSIONID=a'), 'anonymous');
  assert.equal(sessions.labelFor('JSESSIONID=c'), 'c@scriptorium.ro');
});

test('only a guest-shaped bib_guest cookie is a guest name', () => {
  assert.equal(guestNameOf('a=1; bib_guest=guest_formidable_dictator'), 'guest_formidable_dictator');
  assert.equal(guestNameOf('bib_guest=formidable_dictator'), undefined);
  assert.equal(guestNameOf(undefined), undefined);
});
