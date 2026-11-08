import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorLabelForTitleBar } from './authorLabel';

test('title bar hides anonymous-author placeholders but keeps real author names', () => {
  for (const placeholder of ['anon', 'Anonymous', 'ANON.', 'Anonimă', 'Unknown author', 'autor necunoscut', 'N/A']) {
    assert.equal(authorLabelForTitleBar(placeholder), undefined, placeholder);
  }
  assert.equal(authorLabelForTitleBar('William Shakespeare'), 'William Shakespeare');
  assert.equal(authorLabelForTitleBar('Anonymous', 'Gesta Hungarorum'), 'Anonymous');
  assert.equal(authorLabelForTitleBar('Anonymous', 'Another work'), undefined);
});
