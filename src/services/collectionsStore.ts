import type { CollectionItem, PersonalCollection } from '../types/textbase';
import type { PreferencesStore } from './preferencesStore';
import {
  addServerCollectionItem,
  createServerCollection,
  deleteServerCollection,
  fetchMyCollections,
  removeServerCollectionItem,
  renameServerCollection,
  reorderServerCollection,
  type ServerCollectionDto,
  type ServerCollectionItemDto,
} from './serversideApi';

function itemPath(item: CollectionItem): string {
  return item.type === 'work' ? item.workId : item.chapterId || item.referenceId;
}

function itemKey(item: CollectionItem): string {
  return `${item.type}:${itemPath(item)}`;
}

function fromServerItem(item: ServerCollectionItemDto): CollectionItem {
  const path = String(item.divPath || '').replace(/^\//, '');
  const parts = path.split('/');
  const isFragment = String(item.kind || '').toUpperCase() === 'FRAGMENT';
  const type = isFragment ? 'quote' : parts.length > 2 ? 'chapter' : 'work';
  return {
    id: String(item.id || crypto.randomUUID()),
    addedAt: item.addedAt || new Date().toISOString(),
    type,
    referenceId: isFragment && item.fragmentStart && item.fragmentEnd
      ? `${path}#${item.fragmentStart}..${item.fragmentEnd}`
      : path,
    workId: parts.slice(0, 2).join('/'),
    workTitle: item.divHead || path,
    authorName: parts[0] || '',
    chapterId: type === 'chapter' || type === 'quote' ? path : undefined,
    chapterTitle: type === 'chapter' || type === 'quote' ? item.divHead : undefined,
    quoteText: isFragment ? (item.fragmentText || []).join('\n') : undefined,
    snippet: item.snippet,
    score: item.score,
  } as CollectionItem;
}

function fromServer(collection: ServerCollectionDto, userId: string): PersonalCollection {
  const isFavorites = Boolean(collection.favorites) || collection.kind === 'FAVORITES';
  return {
    id: String(collection.id),
    kind: isFavorites ? 'favorites' : 'user',
    userId,
    name: collection.name || (isFavorites ? 'Favorites' : 'Collection'),
    description: undefined,
    isDefaultFavorites: isFavorites,
    createdAt: collection.createdAt || new Date().toISOString(),
    updatedAt: collection.createdAt || new Date().toISOString(),
    items: (collection.items || []).map(fromServerItem),
  };
}

/**
 * Adapter for the server's collection tables. The reader still exposes a
 * synchronous PersonalCollection cache, but every signed-in write is
 * translated to the REST collection operations instead of preferences JSON.
 */
export class ServerCollectionsStore implements PreferencesStore {
  constructor(private readonly userId: string, private readonly legacyPreferences: PreferencesStore) {}

  async get(): Promise<{ collections?: PersonalCollection[] }> {
    const server = await fetchMyCollections();
    const legacy = (await this.legacyPreferences.get()).collections;
    if (server.length > 0) {
      // A previous release may have left user-created collections in the
      // preferences document while the server already provisioned Favorites.
      // Merge only collections whose names are not present remotely.
      const remoteCollections = server.map(collection => fromServer(collection, this.userId));
      const remoteNames = new Set(remoteCollections.map(collection => collection.name));
      const missingLegacy = (legacy || []).filter(collection => !remoteNames.has(collection.name));
      if (missingLegacy.length > 0) {
        await this.set({ collections: [...remoteCollections, ...missingLegacy] });
        await this.legacyPreferences.set({ collections: [] });
        return { collections: [...remoteCollections, ...missingLegacy] };
      }
      return { collections: remoteCollections };
    }

    // One-way migration: an older account may still have its collections in
    // the preference document. Copy them into the collection tables once;
    // subsequent reads come only from /api/collections/mine.
    if (legacy && legacy.length > 0) {
      await this.set({ collections: legacy });
      await this.legacyPreferences.set({ collections: [] });
      return { collections: legacy };
    }
    return { collections: [] };
  }

  async set(patch: { collections?: PersonalCollection[] }): Promise<void> {
    if (!patch.collections) return;
    const desired = patch.collections;
    const existing = await fetchMyCollections();
    const existingById = new Map(existing.map(collection => [String(collection.id), collection]));

    for (const collection of desired) {
      let remote = existingById.get(collection.id)
        || existing.find(candidate => (candidate.name || '') === collection.name);
      if (!remote) {
        remote = await createServerCollection(collection.name);
      } else if ((remote.name || '') !== collection.name && !remote.favorites) {
        await renameServerCollection(String(remote.id), collection.name);
      }

      const remoteItems = remote.items || [];
      const byKey = new Map(remoteItems.map(item => [`${String(item.kind || '').toUpperCase() === 'FRAGMENT' ? 'quote' : String(item.divPath || '').split('/').length > 2 ? 'chapter' : 'work'}:${String(item.divPath || '').replace(/^\//, '')}`, item]));
      const wantedRemoteIds: string[] = [];
      for (const item of collection.items) {
        const key = itemKey(item);
        const found = byKey.get(key);
        if (found?.id) {
          wantedRemoteIds.push(String(found.id));
          continue;
        }
        const reference = item.referenceId.split('#', 2);
        const range = reference[1]?.split('..', 2);
        const added = await addServerCollectionItem(String(remote.id), {
          type: item.type === 'quote' && range?.length === 2 ? 'fragment' : 'div',
          path: reference[0] || itemPath(item),
          ...(item.type === 'quote' && range?.length === 2 ? { start: range[0], end: range[1] } : {}),
        });
        if (added.id) wantedRemoteIds.push(String(added.id));
      }
      for (const item of remoteItems) {
        if (item.id && !wantedRemoteIds.includes(String(item.id))) await removeServerCollectionItem(String(remote.id), String(item.id));
      }
      if (wantedRemoteIds.length > 0) await reorderServerCollection(String(remote.id), wantedRemoteIds);
    }

    const wantedIds = new Set(desired.map(collection => collection.id));
    for (const collection of existing) {
      if (collection.favorites) continue;
      // A newly created collection has a server id unknown to the local
      // cache; only remove known stale ids.
      if (wantedIds.has(String(collection.id)) || desired.some(item => item.name === collection.name)) continue;
      await deleteServerCollection(String(collection.id));
    }
  }
}
