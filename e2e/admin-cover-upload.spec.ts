import { test, expect, type Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

/**
 * The admin cover editor's "Upload image": an image from this computer
 * becomes the cover request's coverArtUrl - scaled down, as a JPEG data:
 * URL - for pictures a site only serves to browsers (e.g. behind a bot
 * check), which the cover renderer cannot fetch itself. "Generate cover"
 * then renders from that JSON as from any other.
 *
 * Who is an admin, and the cover endpoints, are mocked: this is the
 * editor's behaviour, not the renderer's (biblioteca-covers' own tests
 * render data: URLs).
 */

const REQUEST = { title: 'Alexiada', author: 'Ana Comnena', coverArtUrl: 'https://ziarullumina.ro/x.webp', layout: 'woodcut_broadside', theme: { paletteId: 'mint_bubblegum' } };

/** A valid RGB PNG of the given size (uncompressed), so the browser can decode and scale it. */
function png(width: number, height: number): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 3; x++) raw[y * (width * 3 + 1) + 1 + x] = (x + y) & 0xff;
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function asAdminWithCoverEndpoints(page: Page) {
  const posted: any[] = [];
  await page.route('**/api/users/me', route => route.fulfill({ json: { authenticated: true, username: 'admin@example.com', isAdmin: true } }));
  await page.route('**/api/admin/covers/work/request?**', route => route.fulfill({ json: { coverUrl: undefined, request: REQUEST } }));
  await page.route('**/api/admin/covers/work', async route => {
    const body = route.request().postDataJSON();
    posted.push(body);
    await route.fulfill({ json: { coverUrl: undefined, request: body.request } });
  });
  return posted;
}

/** Opens the first work of the catalogue and turns its card to the back face, where the admin cover editor is. */
async function openFirstWorkCoverEditor(page: Page) {
  await page.goto('/app/catalog');
  const first = page.locator('[id^="btn-open-work-"]').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  const workPath = (await first.getAttribute('id'))!.replace('btn-open-work-', '');
  await page.goto(`/app/work/${workPath}`);
  await page.locator('#btn-work-flip-technical-front').click();
}

test('an admin uploads an image: it is scaled into the JSON as coverArtUrl, and Generate cover renders from it', async ({ page }) => {
  const posted = await asAdminWithCoverEndpoints(page);
  await openFirstWorkCoverEditor(page);

  const section = page.getByTestId('admin-cover-section');
  const json = section.getByTestId('admin-cover-request');
  await expect(json).toHaveValue(/ziarullumina\.ro/);

  await section.getByTestId('admin-cover-upload-input').setInputFiles({ name: 'anna.png', mimeType: 'image/png', buffer: png(2000, 1000) });
  await expect(json).toHaveValue(/"coverArtUrl": "data:image\/jpeg;base64,/);
  const edited = JSON.parse(await json.inputValue());
  expect({ ...edited, coverArtUrl: undefined }).toEqual({ ...REQUEST, coverArtUrl: undefined }); // nothing else changed

  // Scaled to fit 1200 px on its longer side.
  const size = await page.evaluate(async (src) => { const image = await createImageBitmap(await (await fetch(src)).blob()); return [image.width, image.height]; }, edited.coverArtUrl);
  expect(size).toEqual([1200, 600]);

  await section.locator('#btn-admin-generate-cover').click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].request.coverArtUrl).toBe(edited.coverArtUrl);
  await expect(section.getByRole('alert')).toHaveCount(0);
});

test('a file that is not an image is refused, with a reason, and the JSON is left as it was', async ({ page }) => {
  await asAdminWithCoverEndpoints(page);
  await openFirstWorkCoverEditor(page);
  const section = page.getByTestId('admin-cover-section');
  const json = section.getByTestId('admin-cover-request');
  await expect(json).toHaveValue(/ziarullumina\.ro/);
  const before = await json.inputValue();

  await section.getByTestId('admin-cover-upload-input').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(section.getByRole('alert')).toContainText('Could not use the image: notes.txt is not an image');
  await expect(json).toHaveValue(before);
});
