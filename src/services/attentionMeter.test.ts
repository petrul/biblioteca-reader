import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttentionMeter } from './attentionMeter';
import { LocalBookmarkStore } from './bookmarkStore';
import { heroCard, isEngagedReader, REAL_READER_THRESHOLD_SECONDS } from './heroCard';

class FakeWebStorage implements Storage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  clear() { this.map.clear(); }
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null; }
  removeItem(key: string) { this.map.delete(key); }
  setItem(key: string, value: string) { this.map.set(key, value); }
}

// A manipulable clock and tab visibility - nothing here actually waits.
function fakeTab() {
  const tab = { nowMs: 1_000_000, visible: true };
  const meter = new AttentionMeter(() => tab.nowMs, () => tab.visible);
  return { tab, meter };
}

// Reads one work for `seconds` with the same 30 s heartbeat flushes as
// useReadingAttention, into a real LocalBookmarkStore.
async function read(store: LocalBookmarkStore, workId: string, seconds: number) {
  const { tab, meter } = fakeTab();
  await store.set(workId, { divPath: `${workId}/chapter_1`, updatedAt: tab.nowMs });
  meter.start();
  for (let left = seconds; left > 0; left -= 30) {
    tab.nowMs += Math.min(30, left) * 1000;
    await store.addAttention(workId, meter.takeWholeSeconds());
  }
}

async function heroAfter(store: LocalBookmarkStore) {
  const all = await store.getAll();
  return heroCard({ shelfKnown: true, isEngagedReader: isEngagedReader(all), shelfWorks: Object.keys(all).length });
}

test('the real-reader threshold is five minutes', () => {
  assert.equal(REAL_READER_THRESHOLD_SECONDS, 300);
});

test('4:59 on a work still shows Explore; 5:00 switches to My Books', async () => {
  const almost = new LocalBookmarkStore(new FakeWebStorage());
  await read(almost, 'sabatini/bellarion', 299);
  assert.equal(isEngagedReader(await almost.getAll()), false);
  assert.equal(await heroAfter(almost), 'explore');

  const enough = new LocalBookmarkStore(new FakeWebStorage());
  await read(enough, 'sabatini/bellarion', 300);
  assert.equal(isEngagedReader(await enough.getAll()), true);
  assert.equal(await heroAfter(enough), 'workspace');
});

test('a whole day of reading never brings the Explore card back', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  await read(store, 'sabatini/bellarion', 8 * 60 * 60);
  assert.equal((await store.get('sabatini/bellarion'))?.attentionSeconds, 8 * 60 * 60);
  assert.equal(await heroAfter(store), 'workspace');
});

test('time is per work, not summed - three works at 2 minutes each are not enough', async () => {
  const store = new LocalBookmarkStore(new FakeWebStorage());
  for (const work of ['a/one', 'b/two', 'c/three']) await read(store, work, 120);
  assert.equal(await heroAfter(store), 'explore');
});

test('time while the tab is hidden is not counted', () => {
  const { tab, meter } = fakeTab();
  meter.start();
  tab.nowMs += 60_000;
  tab.visible = false;
  meter.tick(); // visibilitychange -> hidden
  tab.nowMs += 10 * 60_000;
  tab.visible = true;
  meter.tick(); // visibilitychange -> visible
  tab.nowMs += 30_000;
  assert.equal(meter.takeWholeSeconds(), 90);
});

test('fractional seconds carry over between heartbeats instead of being lost', () => {
  const { tab, meter } = fakeTab();
  meter.start();
  tab.nowMs += 1_500;
  assert.equal(meter.takeWholeSeconds(), 1);
  tab.nowMs += 1_500;
  assert.equal(meter.takeWholeSeconds(), 2);
});
