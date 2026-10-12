import { test, expect } from '@playwright/test';

/**
 * Formalizes that a first-time (not-signed-in) visitor gets Google's
 * automatic one-tap prompt without doing anything - GoogleOneTapAuto,
 * mounted unconditionally in App.tsx whenever /api/users/me reports
 * authenticated:false (see services/identity.ts).
 *
 * The Google Identity Services script itself is faked with a counter on
 * prompt(), same technique roundsq-ui's own google-one-tap tests use -
 * this only needs to prove OUR widget calls prompt(), not that Google's
 * real service works.
 *
 * Requires the dev server already running (see playwright.config.ts) with
 * a non-blank VITE_GOOGLE_CLIENT_ID (see .env.dev) - GoogleOneTapAuto's
 * effect is a no-op with no client id configured at all.
 */

// Simulates the PromptMomentNotification Google's real prompt() callback
// receives - see GoogleOneTap.tsx's logPromptMoment, the diagnostic for
// exactly the "why isn't One Tap showing up" question this formalizes.
// Defaults to "displayed successfully"; pass overrides to simulate
// suppression/skip/dismissal instead.
type MomentOverrides = { isDisplayed?: boolean; notDisplayedReason?: string; isSkippedMoment?: boolean; skippedReason?: string };

async function mockGoogleIdentityServices(page: import('@playwright/test').Page, moment: MomentOverrides = {}) {
  const displayed = moment.isDisplayed ?? true;
  const skipped = moment.isSkippedMoment ?? false;
  await page.route('https://accounts.google.com/gsi/client', async (route) => {
    await route.fulfill({
      contentType: 'application/javascript',
      // Stashes the real callback our own widget registers via
      // initialize(), and exposes __fireGoogleCredential so a test can
      // invoke it directly - simulating the real account picker resolving,
      // without needing Google's actual FedCM UI or a real account.
      // prompt() also invokes whatever moment listener our code passed in,
      // the same way Google's real client reports whether/why the UI
      // actually appeared.
      body: `window.__gsiPromptCount=0;window.google={accounts:{id:{
        initialize(config){window.__gsiConfig=config},
        prompt(momentListener){
          window.__gsiPromptCount++;
          if (momentListener) momentListener({
            getMomentType: () => 'display',
            isDisplayed: () => ${displayed},
            isNotDisplayed: () => ${!displayed && !skipped},
            getNotDisplayedReason: () => ${JSON.stringify(moment.notDisplayedReason ?? '')},
            isSkippedMoment: () => ${skipped},
            getSkippedReason: () => ${JSON.stringify(moment.skippedReason ?? '')},
            isDismissedMoment: () => false,
            getDismissedReason: () => '',
          });
        },
        renderButton(){},
        cancel(){}
      }}};
      window.__fireGoogleCredential=(credential)=>window.__gsiConfig.callback({credential});`,
    });
  });
}

function promptCount(page: import('@playwright/test').Page) {
  return page.evaluate(() => (window as Window & { __gsiPromptCount?: number }).__gsiPromptCount || 0);
}

test('a fresh, not-signed-in visit presents Google One Tap automatically', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  await page.goto('/app/');
  await expect.poll(() => promptCount(page)).toBe(1);
});

/**
 * The other half of "should appear when unauthenticated": OUR code must
 * actually request it be shown (asserted above), but whether Google's
 * real service honors that is outside anything a hermetic test can
 * control - it depends on Google's own live suppression/cooldown state
 * for that browser (e.g. after repeated recent sign-ins/dismissals),
 * which is real, expected behavior on Google's side, not a bug here.
 * What IS our responsibility, and what this locks in: when Google
 * reports it did NOT display the prompt, that reason must be visible
 * (not silently swallowed) - see GoogleOneTap.tsx's logPromptMoment,
 * added specifically so "why isn't it showing up" has an answer instead
 * of indistinguishable silence.
 */
test('when Google suppresses the prompt, the reason is surfaced instead of silently swallowed', async ({ page }) => {
  await mockGoogleIdentityServices(page, { isDisplayed: false, notDisplayedReason: 'suppressed_by_user' });

  const consoleLines: string[] = [];
  page.on('console', (msg) => consoleLines.push(msg.text()));

  await page.goto('/app/');
  await expect.poll(() => promptCount(page)).toBe(1);

  await expect.poll(() =>
    consoleLines.some((line) => line.includes('prompt moment notification') && line.includes('suppressed_by_user'))
  ).toBe(true);
});

test('an already-signed-in visitor is not prompted', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({ json: { authenticated: true, username: 'already_signed_in' } });
  });
  await page.goto('/app/');
  // give GoogleOneTapAuto's effect a fair chance to have fired if it were
  // going to - a poll-to-zero alone can't distinguish "never" from "not yet".
  await page.waitForTimeout(500);
  expect(await promptCount(page)).toBe(0);
});

/**
 * The navbar's identity chip must never show a fake identity as if it
 * were real - see Navbar.tsx's reallySignedIn/realAvatarUrl props (driven
 * by /api/users/me, not the separate demo currentUser persona system,
 * which used to auto-create a "Scholar Petru" persona for every visitor
 * regardless of real auth state).
 */
test('a not-signed-in visitor sees an explicit Guest chip, not a fake identity', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({ json: { authenticated: false } });
  });
  await page.goto('/app/');

  await expect(page.locator('#btn-nav-signin')).toBeVisible();
  await expect(page.locator('#btn-nav-signin')).toContainText('Guest');
  await expect(page.locator('#nav-avatar-real')).toHaveCount(0);
});

test('a signed-in visitor sees their real Google avatar in the navbar', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' },
    });
  });
  await page.goto('/app/');

  await expect(page.locator('#nav-avatar-real')).toBeVisible();
  await expect(page.locator('#nav-avatar-real')).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  await expect(page.locator('#btn-nav-signin')).toHaveCount(0);
});

/**
 * The actual end-to-end sequence a real sign-in goes through: land as
 * Guest, the credential callback fires (simulating the account picker
 * resolving), /api/auth/google succeeds, and the navbar must update to
 * the real avatar WITHOUT a page reload - App.tsx's handleGoogleCredential
 * calls fetchWhoAmI() and setWhoAmI() itself specifically so this doesn't
 * need one. Catches any break in that chain (state update, prop
 * threading, or a stale /api/users/me mock/cache) that a
 * reload-the-page-first test would silently paper over.
 */
test('after signing in, the navbar updates live - no page reload needed', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  let signedIn = false;
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: signedIn
        ? { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' }
        : { authenticated: false },
    });
  });
  await page.route('**/api/auth/google', async (route) => {
    signedIn = true;
    await route.fulfill({ json: { success: true } });
  });

  page.on('console', (msg) => console.log(`[browser] ${msg.text()}`));

  await page.goto('/app/');
  await expect(page.locator('#btn-nav-signin')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__gsiConfig));

  await page.evaluate(() => (window as any).__fireGoogleCredential('fake-credential-token'));

  await expect(page.locator('#nav-avatar-real')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#nav-avatar-real')).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  await expect(page.locator('#btn-nav-signin')).toHaveCount(0);
});

/**
 * submitGoogleCredential's other half: on a successful exchange the raw
 * Google credential is persisted to localStorage (identity.ts's
 * STORED_GOOGLE_CREDENTIAL), which is what makes the next visit's
 * restoreStoredGoogleCredential possible. Nothing here relies on the
 * navbar - a reload keeps the credential where the session cookie
 * alone would not.
 */
test('a successful sign-in persists the Google credential to localStorage and survives a reload', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  let signedIn = false;
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: signedIn
        ? { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' }
        : { authenticated: false },
    });
  });
  await page.route('**/api/auth/google', async (route) => {
    signedIn = true;
    await route.fulfill({ json: { success: true } });
  });

  await page.goto('/app/');
  await page.waitForFunction(() => Boolean((window as any).__gsiConfig));

  await page.evaluate(() => (window as any).__fireGoogleCredential('fake-credential-token'));

  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem('biblioteca.reader.googleCredential.v1'))
  ).toBe('fake-credential-token');

  await page.reload();
  await expect.poll(() =>
    page.evaluate(() => window.localStorage.getItem('biblioteca.reader.googleCredential.v1'))
  ).toBe('fake-credential-token');
});

/**
 * The SEPARATE path from the test above: signing in via the explicit
 * "Continue with Google" button rendered inside AuthModal (GoogleOneTap),
 * not the automatic prompt (GoogleOneTapAuto). Both share one
 * module-level credential-handler slot in GoogleOneTap.tsx - opening the
 * modal overwrites it with AuthModal's own handler while it's mounted.
 * That handler used to only bridge into the demo currentUser system and
 * never told App.tsx a real session existed, so this exact path left the
 * navbar on Guest until a page reload happened to re-check auth state -
 * this is the real bug report this formalizes, distinct from (and not
 * caught by) the auto-prompt test above.
 */
test('signing in via the explicit button inside the modal also updates the navbar live', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  let signedIn = false;
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: signedIn
        ? { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' }
        : { authenticated: false },
    });
  });
  await page.route('**/api/auth/google', async (route) => {
    signedIn = true;
    await route.fulfill({ json: { success: true } });
  });

  await page.goto('/app/');
  await page.locator('#btn-nav-signin').click();
  await expect(page.getByText('Textbase Authentication')).toBeVisible();
  await page.waitForFunction(() => Boolean((window as any).__gsiConfig));

  await page.evaluate(() => (window as any).__fireGoogleCredential('fake-credential-token'));

  await expect(page.getByText('Textbase Authentication')).toHaveCount(0);
  await expect(page.locator('#nav-avatar-real')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#nav-avatar-real')).toHaveAttribute('src', 'https://example.com/avatar.jpg');
  await expect(page.locator('#btn-nav-signin')).toHaveCount(0);
});

/**
 * The identity chip must open the same window either way - Guest opens
 * it to sign in, a real avatar opens it to see/manage that session (e.g.
 * sign out) - rather than the avatar silently doing something else
 * (it used to jump straight to Collections instead).
 */
test('clicking the avatar opens the same auth window whether signed in or not', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' },
    });
  });
  await page.goto('/app/');

  await page.locator('#nav-avatar-real').click();
  await expect(page.getByText('Textbase Authentication')).toBeVisible();
  await expect(page.locator('#btn-real-signout')).toBeVisible();
});

/**
 * The mirror of sign-in: just as real a place for the app's auth state
 * to silently drift from the actual session, so it gets the same
 * live-update scrutiny. Exercises the modal's own sign-out link (there's
 * a second, equivalent one in CollectionsView - both call the same
 * App.tsx handler, so this covers the underlying state-update logic
 * either way).
 */
test('signing out updates the navbar back to Guest live - no page reload needed', async ({ page }) => {
  await mockGoogleIdentityServices(page);
  let signedIn = true;
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: signedIn
        ? { authenticated: true, username: 'reader@example.com', avatarUrl: 'https://example.com/avatar.jpg' }
        : { authenticated: false },
    });
  });
  await page.route('**/api/auth/logout', async (route) => {
    signedIn = false;
    await route.fulfill({ json: { success: true } });
  });

  await page.goto('/app/');
  await expect(page.locator('#nav-avatar-real')).toBeVisible();

  await page.locator('#nav-avatar-real').click();
  await page.locator('#btn-real-signout').click();

  await expect(page.locator('#btn-nav-signin')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#btn-nav-signin')).toContainText('Guest');
  await expect(page.locator('#nav-avatar-real')).toHaveCount(0);
});
