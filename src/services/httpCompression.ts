import compression from 'compression';
import type { RequestHandler } from 'express';

// Response compression, done by the reader itself so every client gets it -
// through Caddy or not (LAN/VPN access to the port, the int stack). A long
// work's table of contents is ~650 KB of JSON per 2000 entries; compressed
// it is a fraction of that. httpCompression.test.ts pins the behaviour:
//
// - text-like responses (JSON, HTML, text, JS, CSS, SVG...) of 1 KB or more
//   are compressed (Brotli or gzip, as the client accepts);
// - smaller ones, already-compressed formats (images, fonts), and clients
//   that do not ask for it are sent as they are.
//
// A proxy in front (Caddy's `encode`) leaves an already-encoded response
// alone, so there is no double compression. Relays from biblioteca-server
// set their own Content-Type and never copy the upstream Content-Encoding
// (fetch has already decoded the body), so they are compressed here like
// any other response. Nothing the reader serves is a stream that must not
// be buffered; one that is added must call res.flush() after each event.

export const COMPRESSION_THRESHOLD_BYTES = 1024;

export function responseCompression(): RequestHandler {
  return compression({ threshold: COMPRESSION_THRESHOLD_BYTES });
}
