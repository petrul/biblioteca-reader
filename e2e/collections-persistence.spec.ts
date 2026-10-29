import { test, expect, type BrowserContext } from '@playwright/test';

// Use a disposable account on a development server. The caller creates and
// cleans up that account; this test never accesses another reader's data.
const username = process.env.COLLECTIONS_TEST_USERNAME;
const password = process.env.COLLECTIONS_TEST_PASSWORD;
const server = process.env.COLLECTIONS_TEST_SERVER_URL || 'http://localhost:8080';

test('account collections survive concurrent preferences, stale sign-in migration and a fresh browser', async ({ browser, baseURL }) => {
  test.skip(!username || !password, 'Requires a disposable development account');
  const contexts: BrowserContext[] = [];
  const signIn = async () => {
    const context = await browser.newContext({ baseURL });
    contexts.push(context);
    const response = await context.request.post(`${server}/login`, {
      form: { username: username!, password: password! }, maxRedirects: 0,
    });
    expect(response.status()).toBe(302);
    return context;
  };
  try {
    const context = await signIn();
    const page = await context.newPage();
    await page.goto('/app/');
    await expect.poll(async () => (await context.request.get('/api/users/me')).json()).toMatchObject({ authenticated: true, username });
    // Wait for the account's initial preferences read/seed to finish.
    await expect.poll(async () => (await context.request.get('/api/users/me/preferences')).json()).toHaveProperty('collections');
    await page.locator('#nav-collections-btn').click();
    await page.locator('#btn-create-collection-modal').click();
    await page.getByPlaceholder('e.g. Stoic Readings, Greek Tragedy, Thesis Notes...').fill('Persistence verification');
    await page.getByRole('button', { name: 'Create Collection', exact: true }).click();
    await expect.poll(async () => {
      const data = await (await context.request.get('/api/users/me/preferences')).json();
      return data.collections?.some((c: any) => c.name === 'Persistence verification');
    }).toBe(true);
    // Exercise the actual Vite-loaded stores, with their real same-origin
    // HTTP proxy, while changing collection contents and UI preferences.
    await page.evaluate(async account => {
      const servicePath = '/src/services/readerService.ts';
      const prefsPath = '/src/services/preferencesStore.ts';
      const { readerService } = await import(/* @vite-ignore */ servicePath);
      const { RemotePreferencesStore, migrateLocalPreferencesToRemote } = await import(/* @vite-ignore */ prefsPath);
      // HMR can give this dynamic module a different URL from App's
      // existing import. Attach its store explicitly before using it.
      await readerService.attachCollectionsStore(account, new RemotePreferencesStore());
      const collection = readerService.getCollections(account).find((c: any) => c.name === 'Persistence verification');
      readerService.addItemToCollection(account, collection.id, {
        type: 'work', referenceId: 'shakespeare/hamlet', workId: 'shakespeare/hamlet',
        workTitle: 'Hamlet', authorName: 'William Shakespeare',
      });
      await Promise.all([
        readerService.flushCollections(account),
        new RemotePreferencesStore().set({ fontSize: 22 }),
        new RemotePreferencesStore().set({ readerTheme: 'paper' }),
      ]);
      localStorage.setItem('biblioteca.reader.preferences.v1', JSON.stringify({ collections: [], fontSize: 24 }));
      await migrateLocalPreferencesToRemote();
    }, username!);
    await page.reload();
    await page.locator('#nav-collections-btn').click();
    await expect(page.getByText('Persistence verification', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Persistence verification 1 item' }).click();
    await expect(page.getByText('Hamlet', { exact: true })).toBeVisible();

    const fresh = await signIn();
    const freshPage = await fresh.newPage();
    await freshPage.goto('/app/');
    await freshPage.locator('#nav-collections-btn').click();
    await expect(freshPage.getByText('Persistence verification', { exact: true })).toBeVisible();
    await freshPage.getByRole('button', { name: 'Persistence verification 1 item' }).click();
    await expect(freshPage.getByText('Hamlet', { exact: true })).toBeVisible();
    const persisted = await (await fresh.request.get('/api/users/me/preferences')).json();
    expect(persisted).toMatchObject({ fontSize: 24, readerTheme: 'paper' });
    expect(persisted.collections.find((c: any) => c.name === 'Persistence verification').items).toHaveLength(1);

    // A rejected write must stay visible and retry the same cached data.
    await freshPage.route('**/api/users/me/preferences', route => route.request().method() === 'PUT'
      ? route.fulfill({ status: 403, json: { error: 'Simulated rejected save' } })
      : route.continue());
    await freshPage.locator('#btn-create-collection-modal').click();
    await freshPage.getByPlaceholder('e.g. Stoic Readings, Greek Tragedy, Thesis Notes...').fill('Retry verification');
    await freshPage.getByRole('button', { name: 'Create Collection', exact: true }).click();
    const notice = freshPage.locator('#server-status-toast');
    await expect(notice).toContainText('Collections not saved');
    await freshPage.unroute('**/api/users/me/preferences');
    await notice.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(notice).toHaveCount(0);
    const retried = await (await fresh.request.get('/api/users/me/preferences')).json();
    expect(retried.collections.some((c: any) => c.name === 'Retry verification')).toBe(true);
    expect(retried.collections.find((c: any) => c.name === 'Persistence verification').items).toHaveLength(1);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
