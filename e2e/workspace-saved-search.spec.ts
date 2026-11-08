import { test, expect } from '@playwright/test';

const saved = {
  id: 'search-frozen-fixture', kind: 'search', name: 'Hamlet passages', query: 'to be', mode: 'lucene',
  scope: 'library', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  items: [{ id: 'hit-1', workId: 'shakespeare/hamlet', workTitle: 'Hamlet', authorName: 'William Shakespeare', chapterId: 'shakespeare/hamlet/1', chapterTitle: 'Act I', snippet: 'To be, or not to be', addedAt: '2026-01-01T00:00:00.000Z' }],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(value => {
    localStorage.setItem('biblioteca_reader_saved_searches', JSON.stringify([value]));
  }, saved);
});

test('workspace opens a drawer and the saved-search entry opens as a frozen document', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('#nav-workspace-btn').click();
  await expect(page.getByTestId('workspace-left-drawer')).toBeVisible();
  await page.locator('#saved-search-search-frozen-fixture button[aria-label="Open frozen search document"]').first().click();
  await expect(page.locator('#saved-search-document')).toBeVisible();
  await expect(page.locator('#saved-search-document')).toContainText('Frozen results for “to be”');
  await expect(page.locator('#saved-search-document')).toContainText('To be, or not to be');
});

test('saved-search document reruns and exports the frozen snapshot', async ({ page }) => {
  await page.goto('/app/search/saved/search-frozen-fixture');
  await expect(page.locator('#saved-search-document')).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTitle('Export MD').click();
  expect((await download).suggestedFilename()).toMatch(/Hamlet-passages\.md$/);
  await page.getByRole('button', { name: 'Rerun search' }).click();
  await expect(page.locator('#input-search-query')).toHaveValue('to be');
});

test('workspace is a mobile bottom sheet and can be discarded', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app/');
  await page.locator('#nav-workspace-btn').evaluate((button: HTMLElement) => button.click());
  await expect(page.getByTestId('workspace-mobile-sheet')).toBeVisible();
  await page.getByRole('button', { name: 'Discard workspace' }).click();
  await expect(page.getByTestId('workspace-mobile-sheet')).toHaveCount(0);
});
