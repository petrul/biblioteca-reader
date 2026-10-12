import assert from 'node:assert/strict';
import test from 'node:test';
import { releasePointerFocus } from './releasePointerFocus';

// A pointer click hands focus back to the page; a keyboard-triggered click
// (detail 0) and a handler that moved focus elsewhere are left alone.
function setup() {
  const blurred: string[] = [];
  const control = { name: 'sparkles', blur() { blurred.push('sparkles'); } };
  const target = { closest: (selector: string) => (selector.includes('button') ? control : null) };
  (globalThis as any).document = { activeElement: control };
  return { blurred, control, target };
}

test('a mouse/touch click releases the focus of the clicked button', () => {
  const { blurred, target } = setup();
  releasePointerFocus({ detail: 1, target } as any);
  assert.deepEqual(blurred, ['sparkles']);
});

test('a keyboard-triggered click (Enter/Space, detail 0) keeps the focus', () => {
  const { blurred, target } = setup();
  releasePointerFocus({ detail: 0, target } as any);
  assert.deepEqual(blurred, []);
});

test('focus a click handler moved elsewhere (a dialog input) stays there', () => {
  const { blurred, target } = setup();
  (globalThis as any).document.activeElement = { name: 'dialog-input' };
  releasePointerFocus({ detail: 1, target } as any);
  assert.deepEqual(blurred, []);
});

test('clicks outside buttons and links are ignored', () => {
  const { blurred } = setup();
  releasePointerFocus({ detail: 1, target: { closest: () => null } } as any);
  assert.deepEqual(blurred, []);
});
