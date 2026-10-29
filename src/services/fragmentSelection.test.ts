import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { selectionFragment } from './fragmentAddress';

async function mapped(run: (window: Window, container: HTMLElement) => void) {
  const window = new Window({ url: 'https://library.test/writer/book/chapter' });
  const keys = ['document', 'Element', 'Node', 'Range'];
  const previous = keys.map(key => Object.getOwnPropertyDescriptor(globalThis, key));
  keys.forEach(key => Object.defineProperty(globalThis, key, { value: (window as any)[key], writable: true, configurable: true }));
  try {
    window.document.body.innerHTML = `<div id="reader"><div data-fragment-version="${'a'.repeat(64)}"><h3>Heading</h3><p data-source-path="2"><span data-fragment-text data-source-path="2" data-fragment-from="10" data-source-from="10">Repeated words.</span><em><span data-fragment-text data-source-path="2.1" data-fragment-from="25" data-source-from="25">Repeated words.</span></em></p><table data-source-path="3"><tbody><tr><td><span data-fragment-text data-source-path="3.1.1" data-fragment-from="40" data-source-from="40">Cell words.</span></td></tr></tbody></table></div></div>`;
    run(window, window.document.querySelector('#reader') as unknown as HTMLElement);
  } finally {
    await window.happyDOM.close();
    keys.forEach((key, i) => { if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!); else delete (globalThis as any)[key]; });
  }
}

test('source mapping disambiguates identical text in distinct inline nodes', async () => {
  await mapped((window, container) => {
    const span = container.querySelector('em span')!;
    const range = window.document.createRange(); range.setStart(span.firstChild as any, 1); range.setEnd(span.firstChild as any, 8);
    const selection = window.getSelection()!; selection.addRange(range);
    assert.deepEqual(selectionFragment(container, selection as unknown as Selection, 'writer/book/chapter'), {
      sourcePath: 'writer/book/chapter', selector: '_2.1:1..2.1:8', revision: 'a'.repeat(64),
    });
  });
});

test('cross-element DOM selection maps from a partial paragraph to a partial table cell', async () => {
  await mapped((window, container) => {
    const range = window.document.createRange();
    range.setStart(container.querySelector('p span')!.firstChild as any, 3);
    range.setEnd(container.querySelector('td span')!.firstChild as any, 4);
    const selection = window.getSelection()!; selection.addRange(range);
    assert.equal(selectionFragment(container, selection as unknown as Selection, 'writer/book/chapter')?.selector, '_2:3..3.1.1:4');
  });
});

test('a clicked block uses its whole source node while manual verse and text selections keep endpoints', async () => {
  await mapped((window, container) => {
    const p = container.querySelector('p')!;
    const range = window.document.createRange(); range.selectNodeContents(p as any);
    const selection = window.getSelection()!; selection.addRange(range);
    assert.equal(selectionFragment(container, selection as unknown as Selection, 'writer/book/chapter')?.selector, '_2');
    selection.removeAllRanges();
    assert.equal(selectionFragment(container, selection as unknown as Selection, 'writer/book/chapter'), null);
  });
});
