# Same URL: the reader and the text edition

Reading URLs follow biblioteca-server exactly: `/{authorId}/{opusId}/{div...}`.
The author page lives at `/{authorId}`. Application pages (catalog, work details,
search, collections, admin and settings) retain `/app/...`. Existing
`/app/reader/...` links redirect permanently to the corresponding root URL.
Root `.html`, `.txt`, `.xml`, `.json` and `/_binary/` requests relay the existing
server response. Browser service requests remain same-origin under `/api/`;
metadata and TOC access uses the generated biblioteca-server client internally.
Reserved infrastructure prefixes include `/api`, `/assets`, `/src`, `/css`,
`/img`, `/js`, `/image`, `/biblioteca`, `/webjars`, `/dav`, `/v2` and `/v3`.

Modern browser navigations receive the JavaScript application. Curl, Lynx and
known crawlers receive the existing server-rendered chapter HTML, rewritten to
root reader links, without scripts or event handlers. `?view=text` explicitly
selects that edition. `Accept: text/plain`, `text/markdown`, or `application/json`
selects an export of the same literary content. Every reader response varies on
`Accept`, `User-Agent` and `Sec-Fetch-Mode`; negotiated responses are private and
require cache revalidation. The SPA advertises its text alternate in its head.

Click a paragraph to select its text and open the standard selection toolbar. Paragraph
ordinals are chapter-local (`?p=17#p17`, ranges `?p=17-19#p17-19`), excluding
ornamental separators. Source IDs are retained. Ordinals can change if an edition
is re-imported with different paragraph breaks. Sharing ranges highlights them
in both editions, keeps the chapter canonical URL, and puts the passage in the
crawler's description. The Edit button currently reports HTTP 501 without saving.

The text twin is always anonymous: it does not forward account cookies. Premium
metadata limits it to the first leaf chapter and preceding title pages; TOC or
upstream failures fail closed. Current live metadata exposes free works only.
The HTML text edition rejects documents above 8 MiB rather than silently
truncating them; normal reader export routes remain available for large sources.

## Similar passages

Click a paragraph or select a text fragment to open the same selection toolbar.
The selected paragraph keeps its gray right-hand bar; there is no separate ¶ button.
Choose **Similar** to run a semantic vector search for that exact selected text.
Results appear in a modal with the work-card TOC design, eight results per page,
loading/empty/error states, retry, and links back to the matching divisions.
Arrow keys page within the modal; Escape closes it. **Save search** stores the
query, vector mode, and results from visited pages through the existing saved
search store (account storage when signed in, browser storage otherwise).
