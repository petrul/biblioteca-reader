import assert from 'node:assert/strict';
import test from 'node:test';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

test('chapter cache preserves HTML and plain text for reading', () => {
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage };
  return import('./chapterCache').then(({ ChapterCache }) => {
    const cache = new ChapterCache(storage);
  const content = {
    htmlContent: '<p>Text</p>',
    plainText: 'Text',
  };
  cache.set('mitru/legendele_olimpului', 'mitru/legendele_olimpului/zeii/slutul', content);
  assert.deepEqual(cache.get('mitru/legendele_olimpului', 'mitru/legendele_olimpului/zeii/slutul'), content);
  });
});
