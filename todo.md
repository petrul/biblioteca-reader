# Biblioteca reader workspace/search TODO

This report records the remaining work after the first workspace vertical
slice. The current implementation already provides an implicit workspace,
desktop drawers, a mobile sheet, signed-in GraphQL synchronization, anonymous
local persistence, saved-search deep links, and HTML/Markdown/ODT export.

## 1. Server-side scoped search — implemented

- Add repeatable `scope` parameters to `/api/search/lucene`, `/api/search/vector`,
  `/api/search/grep`, and `/api/search/divHeads`.
- Apply canonical `authorId/opusId` prefix filtering on the server.
- Add path filtering to Lucene indexes.
- Add metadata/payload filtering to Milvus/vector search.
- Restrict grep scans before scanning text.
- Allow multiple works in one scope.
- Allow a collection to define a search scope.
- Expose the active scope visibly in the search UI.

The reader now sends repeatable `scope` query parameters and the server applies
the scope before limiting Lucene, grep, title and vector results. Lucene uses a
URL prefix filter, grep skips out-of-scope opera before paragraph derivation,
and Milvus applies a native expression where supported (the generic vector
adapter over-fetches and filters server-side). The reader keeps a defensive
filter for older proxies.

## 2. Complete last-search restoration

- Persist fetched result pages, not just query/mode/page metadata.
- Preserve the active result and cursor.
- Restore the highlighted result after reload.
- Restore the exact scroll position.
- Wire `[` and `]` while reading to move through the active search list.
- Sync cursor and active result across devices.
- Use IndexedDB for larger anonymous local state instead of only localStorage.
- Handle changed or deleted saved-search results gracefully.

The current implementation stores a compact, rerunnable descriptor and syncs it
through the versioned GraphQL workspace state.

## 3. Search history — implemented

- Store recent text searches.
- Exclude title/author navigation lookups.
- Show history under an empty search box.
- Support keyboard recall.
- Delete individual entries.
- Clear all history.
- History is local for anonymous readers and stored in the signed-in account's
  preferences document for cross-device recall. It is capped at 20 entries,
  deduplicated, and supports arrow-key recall, per-entry deletion, and clear.

## 4. Unified list model

Introduce the planned `src/library/` abstraction:

- one `Entry` type for works, chapters, fragments, quotes, and search hits;
- adapters for favorites, curated collections, saved searches, and live
  results;
- `EntryList`, `ListKey`, and cursor abstractions;
- asynchronous iteration and paged loading;
- unknown list sizes for open-ended server searches;
- one reusable list renderer for search, collections, saved searches, and
  drawers;
- virtualization for large lists.

The current UI still has separate models and renderers for collections, saved
searches, and live search results.

## 5. Collection-storage unification — initial implementation

- Move curated collections and favorites from the preferences JSON blob into
  the server collection tables.
- Add a migration from the existing preferences representation.
- Keep anonymous readers on a local adapter implementing the same interface.
- Add server operations for add, remove, reorder, move, copy, rename, and
  describe.
- Establish a first-class working collection.
- Add “Add to working collection” to the reader toolbar, selected-text
  toolbar, search results, and drawer entries.
- Add undo feedback after adding an item.

Saved searches already use the new GraphQL CRUD path. Signed-in curated
collections and Favorites now use `/api/collections/mine` and its add/remove/
reorder/rename/delete operations through `ServerCollectionsStore`; the old
preferences representation is read once and copied into the server tables.
Anonymous readers retain the local preferences adapter. The working-collection
pin and explicit undo UI remain follow-up work.

## 6. Saved searches as transversal documents

- Render a saved search as its own center-reader document instead of only
  rerunning its query.
- Preserve and display the frozen result snapshot.
- Show query, mode, scope, source labels, scores, and timestamps.
- Add an explicit “Keep as collection” action.
- Keep saved searches immutable as snapshots.
- Separate “open frozen snapshot” from “rerun search”.
- Use an internal identity such as `search:<uuid>` for the document model.

HTML, Markdown, and minimal valid ODT package exports are implemented, but the
center-reader document presentation is not yet a separate document model.

## 7. Real workspace drawers

- Let each drawer select a specific collection or saved search.
- Persist the selected list per drawer.
- Give each drawer its own filter and cursor.
- Track which drawer is active.
- Open entries in the center reader without losing drawer state.
- Make `[` and `]` operate on the focused drawer/list.
- Add open/add/move/copy/remove actions to drawer entries.
- Add collapsible drawers.
- Add resizable desktop drawers.
- Add mobile bottom-sheet peek, half, and full snap states.
- Add swipe/drag handling for the mobile workspace sheet.
- Preserve filters and expansion state during navigation.

The current shell renders the existing collections panel in fixed left/right
desktop drawers and one mobile sheet. It does not yet select independent lists
or maintain independent cursors.

## 8. Named workspaces

- Create named workspace documents.
- Add a workspace switcher.
- Store separate drawer contents, filters, working collection, scope, and
  active cursors per workspace.
- Sync named workspaces across devices.
- Discard one workspace without deleting its collections or saved searches.

Only one implicit workspace currently exists.

## 9. Bible reference search

- Add a Reference search mode.
- Parse references such as `1 Samuel 17`, `1 Sam 21:6`, and `1 Regi 21:6`.
- Build a per-edition reference index.
- Support Romanian and English naming.
- Preserve the canonical `/trad/biblia-*` namespace.
- Handle chapter/verse numbering differences.
- Open the correct chapter directly.
- Offer equivalent references in the other current Bible work.
- Add citation copying with or without quoted text.

The current code only preserves the canonical Bible route behavior.

## 10. Bible cross-references

- Select and verify a licensed cross-reference dataset.
- Add references such as Matthew 12:3–4 ↔ 1 Samuel 21:6.
- Display cross-references from selected passages.
- Keep cross-reference navigation inside the list/workspace model.

## 11. Browser-level testing

Add Playwright/e2e coverage for:

- workspace toggle from the navbar;
- desktop left/right drawers;
- mobile bottom sheet;
- discard and reopen behavior;
- independent drawer filters;
- saved-search deep links;
- HTML/Markdown/ODT downloads;
- signed-in synchronization;
- revision conflicts between two sessions;
- last-search restoration after reload;
- `[` / `]` navigation through a search list;
- Bible route preservation;
- anonymous sign-in prompts for sync-only features.

The current unit suites cover the GraphQL gateway, workspace store, route
parsing, saved-search operations, and ODT package generation.

## 12. Deployment and migration verification

- Run Flyway V12 in every target Biblioteca environment.
- Verify the deployed GraphQL schema contains the workspace operations.
- Configure `BIBLIOTECA_INTERNAL_API_TOKEN` in the reader deployment.
- Verify the same-origin `/api/reader-graphql` gateway in deployment.
- Run the relevant TeamCity snapshot builds.
- Test signed-in and anonymous behavior against the deployed profile.

## Recommended execution order

1. Server-side scoped search.
2. Unified entry/list model.
3. Collection-storage migration and working collection.
4. Real drawer list selection and cursors.
5. Complete last-search restoration with `[` / `]`.
6. Bible reference search.
7. Named workspaces and multi-device polish.
