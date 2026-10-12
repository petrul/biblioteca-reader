import { test, expect } from '@playwright/test';

/**
 * The admin page (AdminView) exists at /app/admin regardless of who's
 * asking - App.tsx is what decides whether it actually renders, gated on
 * whoAmI.isAdmin (see identity.ts's WhoAmI type). That field comes
 * straight from biblioteca-server's own ADMIN_USERS allow-list (see
 * AdminUsers/SecurityConfig there) - this only needs to prove the reader
 * honors what the server reports, not re-derive who's an admin itself.
 * The real enforcement is server-side (/api/admin/** itself requires the
 * same allow-list, see AdminUsersAccessTest in biblioteca-server) - this
 * is UI-visibility coverage, not a substitute for that.
 */

async function mockWhoAmI(page: import('@playwright/test').Page, isAdmin: boolean) {
  await page.route('**/api/users/me', async (route) => {
    await route.fulfill({
      json: { authenticated: true, username: 'someone@example.com', isAdmin },
    });
  });
}

test('a non-admin signed-in user visiting /app/admin does not see the admin page', async ({ page }) => {
  await mockWhoAmI(page, false);
  await page.goto('/app/admin');
  await expect(page.locator('#select-admin-repo')).toHaveCount(0);
});

test('an admin user visiting /app/admin sees the admin page', async ({ page }) => {
  await mockWhoAmI(page, true);
  await page.goto('/app/admin');
  await expect(page.locator('#select-admin-repo')).toBeVisible();
});
