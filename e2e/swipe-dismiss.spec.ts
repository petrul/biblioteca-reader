import { test, expect, type Page } from '@playwright/test';

/**
 * Covers the touch-swipe-to-dismiss behavior on the admin sidebar
 * (src/hooks/useDragToDismiss.ts - tracks the finger live so the panel
 * visually follows the drag) and the Collections view
 * (src/hooks/useSwipeDismiss.ts - net-delta-at-release only), including
 * that the dismissal is animated rather than instant: both panels stay
 * mounted and visible for one transition duration after a close is
 * triggered, then disappear.
 *
 * Requires the dev server already running (see playwright.config.ts).
 *
 * swipe() fires an intermediate touchmove (not just touchstart/touchend),
 * since useDragToDismiss only updates its live drag position on
 * touchmove - a real swipe always includes move events, so this matches
 * actual usage rather than being test-only plumbing.
 */

async function swipe(page: Page, selector: string, fromX: number, toX: number, y = 400) {
  async function fireTouch(type: string, x: number) {
    await page.evaluate(
      ({ selector, type, x, y }) => {
        const el = document.querySelector(selector) as HTMLElement | null;
        if (!el) throw new Error(`swipe target not found: ${selector}`);
        const touch = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        const evt = new TouchEvent(type, {
          touches: type === 'touchend' ? [] : [touch],
          changedTouches: [touch],
          targetTouches: type === 'touchend' ? [] : [touch],
          bubbles: true,
          cancelable: true,
        });
        el.dispatchEvent(evt);
      },
      { selector, type, x, y },
    );
  }
  await fireTouch('touchstart', fromX);
  await fireTouch('touchmove', toX);
  await fireTouch('touchend', toX);
}

test.describe('admin sidebar (hamburger)', () => {
  test('opens on tap, closes on swipe-left with an animated (non-instant) close', async ({ page }) => {
    await page.goto('/app/');
    const heading = page.getByText('Reader Navigation & Library');

    await page.locator('#nav-logo-hamburger-btn').click();
    await expect(heading).toBeVisible();

    await swipe(page, '.w-screen.max-w-md', 300, 100);

    // Immediately after the swipe the panel must still be there - the
    // close is deferred to play the slide-out transition, not instant.
    await expect(heading).toBeVisible();
    await expect(heading).toBeHidden({ timeout: 1000 });
  });

  test('closes on Escape', async ({ page }) => {
    await page.goto('/app/');
    await page.locator('#nav-logo-hamburger-btn').click();
    await expect(page.getByText('Reader Navigation & Library')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Reader Navigation & Library')).toBeHidden({ timeout: 1000 });
  });

  const panel = '.w-screen.max-w-md';

  async function touch(page: Page, type: string, x: number, y = 400) {
    await page.evaluate(
      ({ panel, type, x, y }) => {
        const el = document.querySelector(panel) as HTMLElement;
        const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(
          new TouchEvent(type, {
            touches: type === 'touchend' ? [] : [t],
            changedTouches: [t],
            targetTouches: type === 'touchend' ? [] : [t],
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { panel, type, x, y },
    );
  }

  test('panel translateX follows the finger live while dragging', async ({ page }) => {
    await page.goto('/app/');
    await page.locator('#nav-logo-hamburger-btn').click();
    await expect(page.getByText('Reader Navigation & Library')).toBeVisible();

    await touch(page, 'touchstart', 300);
    for (const dx of [10, 30, 60]) {
      await touch(page, 'touchmove', 300 - dx);
      await expect(page.locator(panel)).toHaveCSS('transform', `matrix(1, 0, 0, 1, -${dx}, 0)`);
    }
    await touch(page, 'touchend', 240);
  });

  test('releasing before the threshold snaps back open instead of closing', async ({ page }) => {
    await page.goto('/app/');
    const heading = page.getByText('Reader Navigation & Library');
    await page.locator('#nav-logo-hamburger-btn').click();
    await expect(heading).toBeVisible();

    await touch(page, 'touchstart', 300);
    await touch(page, 'touchmove', 260); // dx = -40, under the 80px threshold
    await touch(page, 'touchend', 260);

    await page.waitForTimeout(400); // longer than the snap-back/close transition
    await expect(heading).toBeVisible();
  });
});

// Was "collections view (avatar)" - the navbar avatar chip used to toggle
// Collections open/closed on repeat taps, back when it was driven by the
// always-truthy demo currentUser persona. It's now driven by real Google
// auth state instead (an explicit "Guest" chip when not really signed in -
// see Navbar.tsx), so opening Collections goes through the nav button, and
// swipe-to-dismiss (tested below) is this view's only close gesture.
test.describe('collections view', () => {
  test('closes on swipe-right with an animated close', async ({ page }) => {
    await page.goto('/app/');
    const marker = page.getByText('YOUR READING LISTS');

    await page.locator('#nav-collections-btn').first().click({ force: true });
    await expect(marker).toBeVisible();

    await swipe(page, '.fixed.inset-0.z-30', 100, 300);

    await expect(marker).toBeVisible();
    await expect(marker).toBeHidden({ timeout: 1000 });
  });
});
