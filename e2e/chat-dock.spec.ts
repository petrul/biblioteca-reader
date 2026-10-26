import { test, expect } from '@playwright/test';

/**
 * The dockable assistant: a long-press (~450ms) turns the floating chat
 * bubble into a drag ghost; dropped on the bottom nav it becomes the bar's
 * fourth tab, dropped anywhere else it snaps back to its corner. The docked
 * tab opens the same chat panel, and a long-press drag from the bar back
 * into the content floats the bubble again. Docking persists via
 * localStorage, and grabbing the bubble reveals the auto-hidden bar so it
 * can receive the drop.
 *
 * Requires the dev server already running (see playwright.config.ts).
 */

test.use({ viewport: { width: 600, height: 400 } });

const bubble = (page: import('@playwright/test').Page) => page.locator('[data-testid="biblioteca-chat-widget"]').getByRole('button', { name: /chatul/ });
const chatTab = (page: import('@playwright/test').Page) => page.locator('#mobile-nav-chat');
const panel = (page: import('@playwright/test').Page) => page.locator('section[aria-label="Biblioteca chat"]');

async function longPressDrag(page: import('@playwright/test').Page, from: import('@playwright/test').Locator, to: { x: number; y: number }) {
  const box = await from.boundingBox();
  if (!box) throw new Error('drag source has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600); // past the 450ms long-press
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

async function dockChat(page: import('@playwright/test').Page) {
  const nav = page.locator('#mobile-bottom-nav');
  const navBox = await nav.boundingBox();
  if (!navBox) throw new Error('bottom nav has no box');
  await longPressDrag(page, bubble(page), { x: navBox.x + navBox.width / 2, y: navBox.y + navBox.height / 2 });
  await page.mouse.up();
  await expect(chatTab(page)).toBeVisible();
}

test('long-press drag docks the bubble into the bottom nav', async ({ page }) => {
  await page.goto('/app/');
  await expect(bubble(page)).toBeVisible();
  await expect(chatTab(page)).toHaveCount(0);

  await dockChat(page);

  await expect(bubble(page)).toBeHidden();
});

test('the docked tab opens the same chat panel', async ({ page }) => {
  await page.goto('/app/');
  await dockChat(page);

  await chatTab(page).click();
  await expect(panel(page)).toBeVisible();
});

test('long-press drag from the bar floats the bubble again', async ({ page }) => {
  await page.goto('/app/');
  await dockChat(page);

  await longPressDrag(page, chatTab(page), { x: 300, y: 150 });
  await page.mouse.up();

  await expect(chatTab(page)).toHaveCount(0);
  await expect(bubble(page)).toBeVisible();
});

test('a drop outside the bar snaps the bubble back to its corner', async ({ page }) => {
  await page.goto('/app/');

  await longPressDrag(page, bubble(page), { x: 300, y: 150 });
  await page.mouse.up();

  await expect(chatTab(page)).toHaveCount(0);
  await expect(bubble(page)).toBeVisible();
});

test('the docked placement survives a reload', async ({ page }) => {
  await page.goto('/app/');
  await dockChat(page);

  await page.reload();

  await expect(chatTab(page)).toBeVisible();
  await expect(bubble(page)).toBeHidden();
});

test('grabbing the bubble reveals the auto-hidden bar as a drop target', async ({ page }) => {
  await page.goto('/app/');
  await page.locator('[id^="btn-open-work-"]').first().click();
  await page.locator('#btn-read-first-chapter').click();
  await expect(page.locator('.reader-text-container')).toBeVisible();
  const next = page.locator('#btn-reader-next-chapter');
  if (await next.count()) {
    await next.click();
    await expect(page.locator('#btn-reader-next-chapter')).toBeVisible();
  }

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
  await expect(page.locator('#mobile-bottom-nav')).toHaveClass(/translate-y-full/);

  // Grab the bubble and start dragging: the bar must slide back in, ready
  // to receive the drop. Releasing away from the bar keeps it a no-op.
  const box = await bubble(page).boundingBox();
  if (!box) throw new Error('bubble has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.move(box.x - 60, box.y - 60, { steps: 6 });
  await expect(page.locator('#mobile-bottom-nav')).toHaveClass(/translate-y-0/);

  await page.mouse.move(300, 150, { steps: 6 });
  await page.mouse.up();
  await expect(chatTab(page)).toHaveCount(0);
  await expect(bubble(page)).toBeVisible();
});

// Desktop (lg+): the bottom nav does not exist there - the dock target is
// the navbar at the top, and the docked chat lives in it as a nav button.
test.describe('desktop: the navbar is the dock target', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  const navChatButton = (page: import('@playwright/test').Page) => page.locator('#nav-chat-btn');

  async function dockChatToNavbar(page: import('@playwright/test').Page) {
    const nav = page.locator('#navbar');
    const navBox = await nav.boundingBox();
    if (!navBox) throw new Error('navbar has no box');
    await longPressDrag(page, bubble(page), { x: navBox.x + navBox.width / 2, y: navBox.y + navBox.height / 2 });
    await page.mouse.up();
    await expect(navChatButton(page)).toBeVisible();
  }

  test('long-press drag docks the bubble into the navbar', async ({ page }) => {
    await page.goto('/app/');
    await expect(bubble(page)).toBeVisible();
    await expect(navChatButton(page)).toHaveCount(0);

    await dockChatToNavbar(page);

    await expect(bubble(page)).toBeHidden();
  });

  test('the docked navbar button opens the same chat panel', async ({ page }) => {
    await page.goto('/app/');
    await dockChatToNavbar(page);

    await navChatButton(page).click();
    await expect(panel(page)).toBeVisible();
  });

  test('long-press drag from the navbar floats the bubble again', async ({ page }) => {
    await page.goto('/app/');
    await dockChatToNavbar(page);

    await longPressDrag(page, navChatButton(page), { x: 640, y: 400 });
    await page.mouse.up();

    await expect(navChatButton(page)).toHaveCount(0);
    await expect(bubble(page)).toBeVisible();
  });

  test('grabbing the bubble reveals the auto-hidden navbar as a drop target', async ({ page }) => {
    await page.goto('/app/');
    await page.locator('[id^="btn-open-work-"]').first().click();
    await page.locator('#btn-read-first-chapter').click();
    await expect(page.locator('.reader-text-container')).toBeVisible();
    const next = page.locator('#btn-reader-next-chapter');
    if (await next.count()) {
      await next.click();
      await expect(page.locator('#btn-reader-next-chapter')).toBeVisible();
    }

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight * 0.6));
    await expect(page.locator('#navbar')).toHaveClass(/-translate-y-full/);

    const box = await bubble(page).boundingBox();
    if (!box) throw new Error('bubble has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(600);
    await page.mouse.move(box.x - 60, box.y - 60, { steps: 6 });
    await expect(page.locator('#navbar')).toHaveClass(/translate-y-0/);

    await page.mouse.move(640, 400, { steps: 6 });
    await page.mouse.up();
    await expect(navChatButton(page)).toHaveCount(0);
    await expect(bubble(page)).toBeVisible();
  });
});
