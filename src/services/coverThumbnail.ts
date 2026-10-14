/** Cover images go through the reader gateway; stored original URLs stay intact. */
export type CoverThumbnailWidth = 160 | 320 | 640;
export function coverThumbnailUrl(source: string | undefined, width: CoverThumbnailWidth = 320): string | undefined {
  if (!source || !/^https?:\/\//i.test(source)) return source;
  return `/api/cover-thumbnails?${new URLSearchParams({ url: source, width: String(width) })}`;
}
