import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { onPointerDownOutside } from './outsideTap';

// The chat box's theme picker closes on a tap outside it: anywhere in the
// page or elsewhere in the chat box - but not on the picker itself, nor on
// the button that toggles it (that button's own click does the toggling).

function setup() {
  const window = new Window({ url: 'http://localhost/' });
  const document = window.document as unknown as Document;
  document.body.innerHTML = `
    <section id="chat">
      <button id="toggle">themes</button>
      <div id="picker"><button id="theme">Dusk</button></div>
      <div id="messages">hello</div>
    </section>
    <main id="page">reading</main>`;
  const byId = (id: string) => document.getElementById(id)!;
  let closed = 0;
  const stop = onPointerDownOutside(document, () => [byId('picker'), byId('toggle')], () => { closed++; });
  const tap = (id: string) => byId(id).dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }) as unknown as Event);
  return { tap, closed: () => closed, stop, close: () => window.happyDOM.close() };
}

test('a tap outside the picker closes it - in the page or elsewhere in the chat box', async () => {
  const t = setup();
  t.tap('page');
  t.tap('messages');
  assert.equal(t.closed(), 2);
  await t.close();
});

test('a tap on the picker or on its toggle button leaves it to them', async () => {
  const t = setup();
  t.tap('theme');
  t.tap('picker');
  t.tap('toggle');
  assert.equal(t.closed(), 0);
  await t.close();
});

test('once the picker is gone, taps no longer reach the listener', async () => {
  const t = setup();
  t.stop();
  t.tap('page');
  assert.equal(t.closed(), 0);
  await t.close();
});
