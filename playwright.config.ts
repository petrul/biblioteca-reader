import { defineConfig } from '@playwright/test';

// e2e/ tests expect the dev server already running (rake start[dev] or
// npm run dev) - see e2e/swipe-dismiss.spec.ts. No webServer auto-start
// here since this app's dev profile (.env.dev, PORT, TEXTBASE_SERVER_URL)
// is loaded by the rakefile, not by a plain `npm run dev` invocation.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3333',
    hasTouch: true,
  },
});
