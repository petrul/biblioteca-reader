// The reader's REAL identity (a real textbase-server AppUser, via Google
// Sign-In) - deliberately separate from readerService's own demo
// persona/localStorage user system (which stays untouched for the existing
// browse/collections/payment demo flows). This is the layer bookmarks
// (see bookmarkStore.ts) actually key off: signed in for real -> reading
// position lives on textbase-server; not -> it lives in this browser only.

import { BookmarkStore, LocalBookmarkStore, RemoteBookmarkStore, migrateLocalToRemote } from './bookmarkStore';
import {
  LocalPreferencesStore,
  PreferencesStore,
  RemotePreferencesStore,
  migrateLocalPreferencesToRemote
} from './preferencesStore';
import { fetchCurrentUser, postGoogleCredential, postGoogleProfileAccessToken, postLogout } from './serversideApi';
import {
  restoreStoredGoogleCredential as restoreStoredGoogleCredentialInto,
  storeGoogleCredential,
  purgeStoredGoogleCredential,
  disableGoogleAutoSelect,
  requestGoogleProfileAccessToken,
} from './googleOneTapAuth';
import { readerService } from './readerService';
import { isEngagedReader } from './heroCard';
import { Work } from '../types/textbase';

// isAdmin comes from the server's ADMIN_USERS allow-list (see biblioteca-server's
// AdminUsers/SecurityConfig) - purely a display hint for hiding/showing the
// admin page and its nav entry points (see App.tsx). The real enforcement is
// server-side: /api/admin/** itself requires being on that same allow-list,
// so this can't be spoofed into real admin access, only into seeing UI for
// features that would 403 anyway.
export type WhoAmI = { authenticated: boolean; username?: string; avatarUrl?: string; isAdmin?: boolean };

export async function fetchWhoAmI(): Promise<WhoAmI> {
  try {
    const who = await fetchCurrentUser();
    console.debug('[identity] fetchWhoAmI result', who);
    return who as unknown as WhoAmI;
  } catch (error) {
    console.debug('[identity] fetchWhoAmI FAILED', error);
    return { authenticated: false };
  }
}

export type GoogleSignInResult = { success: boolean; error?: string; avatarUrl?: string };
const STORED_GOOGLE_CREDENTIAL = 'biblioteca.reader.googleCredential.v1';
const STORED_GOOGLE_AVATAR = 'biblioteca.reader.googleAvatar.v1';

export function cachedGoogleAvatar(): string | undefined {
  const value = window.localStorage.getItem(STORED_GOOGLE_AVATAR);
  return value || undefined;
}

export function restoreStoredGoogleCredential(): string | null {
  return restoreStoredGoogleCredentialInto(STORED_GOOGLE_CREDENTIAL);
}

/**
 * Exchanges a Google ID token credential for a real textbase-server
 * session (server.ts's /api/auth/google proxy does the actual upstream
 * call + cookie relay). On success, migrates whatever was in the local
 * (anonymous) bookmark store up to the account and clears local - see
 * migrateLocalToRemote's own doc for why that's a merge, not a replace.
 */
export async function submitGoogleCredential(credential: string): Promise<GoogleSignInResult> {
  console.debug('[identity] submitGoogleCredential: POSTing to /api/auth/google', { credentialLength: credential.length });
  const result = (await postGoogleCredential(credential)) as GoogleSignInResult;
  console.debug('[identity] submitGoogleCredential result', result);
  if (result.success) {
    storeGoogleCredential(STORED_GOOGLE_CREDENTIAL, credential);
    console.debug('[identity] migrating local bookmarks to remote after sign-in');
    await migrateLocalToRemote(new LocalBookmarkStore(), new RemoteBookmarkStore());
    console.debug('[identity] migrating local preferences to remote after sign-in');
    await migrateLocalPreferencesToRemote().catch((error) =>
      console.debug('[identity] preference migration unavailable', error));
  }
  return result;
}

/** Best-effort profile refresh; login remains valid if Google declines a silent token request. */
export async function refreshGoogleProfile(): Promise<GoogleSignInResult> {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!clientId) return { success: false, error: 'Google client id is not configured' };
  try {
    const accessToken = await requestGoogleProfileAccessToken(clientId);
    const profile = await postGoogleProfileAccessToken(accessToken);
    if (!profile.success || !profile.avatarUrl) throw new Error(profile.error || 'Google profile contains no picture');
    // The same profile URL is persisted server-side when possible, but the
    // local cache makes the avatar immediately available to this reader and
    // survives a server response that omitted the optional picture field.
    window.localStorage.setItem(STORED_GOOGLE_AVATAR, profile.avatarUrl);
    return { success: true, avatarUrl: profile.avatarUrl };
  } catch (error) {
    console.debug('[identity] Google profile refresh unavailable', error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Ends the real textbase-server session (server.ts's /api/auth/logout
 * proxy bridges to Spring Security's own default POST /logout). Does not
 * touch local bookmark storage - there's nothing to migrate backwards;
 * bookmarkStoreFor(false) simply starts serving LocalBookmarkStore again
 * once the caller re-fetches whoAmI and reallySignedIn goes false.
 */
export async function signOut(): Promise<void> {
  purgeStoredGoogleCredential(STORED_GOOGLE_CREDENTIAL);
  window.localStorage.removeItem(STORED_GOOGLE_AVATAR);
  // One-tap runs with auto_select (see googleOneTapAuth.ts's policy), so
  // an explicit sign-out must end it for this origin - otherwise the
  // next page load would silently re-authenticate a reader who just
  // chose to leave.
  disableGoogleAutoSelect();
  console.debug('[identity] signOut: POSTing to /api/auth/logout');
  await postLogout().catch((error) => {
    console.debug('[identity] signOut FAILED', error);
  });
}

export function bookmarkStoreFor(signedIn: boolean): BookmarkStore {
  return signedIn ? new RemoteBookmarkStore() : new LocalBookmarkStore();
}

// Same selection as bookmarkStoreFor above: a signed-in reader's UI
// preferences follow the account (textbase-server's per-reader JSON
// document), an anonymous reader's stay in this browser's localStorage -
// callers only ever see the one PreferencesStore interface.
export function preferencesStoreFor(signedIn: boolean): PreferencesStore {
  return signedIn ? new RemotePreferencesStore() : new LocalPreferencesStore();
}

export type MyBooksShelf = {
  works: Work[];
  // Whether this reader has demonstrated real engagement (not just
  // clicking around) - see heroCard.ts's REAL_READER_THRESHOLD_SECONDS. `works` itself
  // is NOT filtered by this - once a reader qualifies, they see every
  // touched work on the shelf, not just the one that crossed the bar.
  isEngagedReader: boolean;
};

/**
 * "My Books" shelf: every work this reader has touched (opened at least
 * one chapter of, local or remote depending on signedIn), the work
 * they've spent the most real time on first - most recently touched
 * first as a tiebreaker, which in practice means most freshly-opened
 * works (still at 0 accumulated attentionSeconds) fall back to recency
 * order. Backed entirely by the bookmark position (and attentionSeconds)
 * each work already has - see bookmarkStore.ts - so there's no separate
 * tracking to maintain here. Caps at 20, purely to keep the shelf a
 * reasonable horizontal scroll rather than unbounded.
 */
export async function getMyBooksShelf(signedIn: boolean, limit = 20): Promise<MyBooksShelf> {
  const all = await bookmarkStoreFor(signedIn).getAll();
  const entries = Object.entries(all);

  const works = entries
    .sort(([, a], [, b]) => {
      const byAttention = (b.attentionSeconds ?? 0) - (a.attentionSeconds ?? 0);
      return byAttention !== 0 ? byAttention : b.updatedAt - a.updatedAt;
    })
    .slice(0, limit)
    .map(([workId]) => readerService.getWorkById(workId))
    .filter((work): work is Work => Boolean(work));

  return { works, isEngagedReader: isEngagedReader(all) };
}
