// An administrator's own image as a cover's art: for pictures a site only
// serves to browsers (behind a bot check, e.g. ziarullumina.ro), which the
// cover renderer can never fetch itself. The browser reads the file, scales
// it down and puts it in the cover request JSON as a data: URL - the JSON
// stays the one thing "Generate cover" renders from.

/** Longest side of an uploaded cover image, in pixels: the cover's art oval is far smaller. */
export const COVER_ART_MAX_SIDE = 1200;

/** Reads an image file and returns it scaled to fit COVER_ART_MAX_SIDE, as a JPEG data: URL (browser only). */
export async function coverArtDataUrl(file: File, maxSide = COVER_ART_MAX_SIDE, quality = 0.85): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('this browser cannot scale images');
    context.fillStyle = '#ffffff'; // JPEG has no transparency
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    bitmap.close();
  }
}

/** The cover request JSON text with its coverArtUrl set to `dataUrl`, the rest unchanged. */
export function withCoverArt(jsonText: string, dataUrl: string): string {
  let request: unknown;
  try { request = JSON.parse(jsonText); } catch { throw new Error('the JSON is not valid - fix it before uploading an image'); }
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('the JSON must be an object');
  return JSON.stringify({ ...(request as Record<string, unknown>), coverArtUrl: dataUrl }, null, 2);
}
