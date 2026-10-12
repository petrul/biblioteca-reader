// Google One Tap, isolated as ONE self-contained, framework-free module.
//
// Zero imports, no React, no app types: the only things it touches are the
// browser globals it needs (document for the GIS script tag, window.google
// for the GIS API, window.localStorage for the stored credential), and
// every app-specific decision is injected - the OAuth client id, the
// localStorage key, and the callback that exchanges the credential with
// YOUR backend. To reuse this in another UI service, copy this file (and
// googleOneTapAuth.test.ts) and wire those three things - that is the
// whole integration:
//
//   const oneTap = new GoogleOneTapAuth({
//     clientId: '...',                         // your Google OAuth client id
//     credentialStorageKey: 'app.googleCredential.v1',
//     onCredential: exchangeWithYourBackend,    // see storeGoogleCredential below
//     onError: showSignInError,
//   });
//   await oneTap.ready();      // loads GIS + initializes, once
//   oneTap.presentPrompt();    // the auto one-tap prompt
//   oneTap.renderButton(el);   // the explicit Continue-with-Google button
//
// The persistence contract this module implements (the pieces a sign-in
// must have to survive page loads - all covered by the test file):
//   - GIS is initialized with auto_select: true, so a returning visitor
//     with an active Google session is silently re-credentialed on every
//     visit (a fresh ID token each time);
//   - your onCredential callback, on SUCCESSFUL backend exchange, stores
//     the token (storeGoogleCredential) so the next visit can re-exchange
//     it while it is still valid;
//   - an explicit sign-out purges the stored credential AND calls
//     disableAutoSelect, so leaving is respected instead of being
//     instantly undone by the next auto-select;
//   - a stored token past its exp (~1h) is purged on restore - it can no
//     longer authenticate anything.
//
// Why auto_select matters here: the average backend session (e.g. a plain
// servlet cookie) dies with the browser, and a Google ID token only lives
// about an hour - without silent re-credentialing, the whole chain is
// "signed in within the last hour" and every later visit lands logged out.

export type GoogleCredentialResponse = { credential: string; select_by?: string };

// https://developers.google.com/identity/gsi/web/reference/js-reference#PromptMomentNotification
// - Google's own diagnostic for "why did/didn't the prompt show", logged
// unconditionally so a silent no-op is visible instead of
// indistinguishable from "nothing happened yet".
export interface PromptMomentNotification {
  isDisplayMoment(): boolean;
  isDisplayed(): boolean;
  isNotDisplayed(): boolean;
  getNotDisplayedReason(): string;
  isSkippedMoment(): boolean;
  getSkippedReason(): string;
  isDismissedMoment(): boolean;
  getDismissedReason(): string;
  getMomentType(): string;
}

type GoogleIdApi = {
  initialize(options: Record<string, unknown>): void;
  prompt(momentListener?: (notification: PromptMomentNotification) => void): void;
  renderButton(parent: HTMLElement, options: Record<string, unknown>): void;
  cancel(): void;
  disableAutoSelect(): void;
};

type GoogleOAuthTokenClient = {
  requestAccessToken(options?: { prompt?: string }): void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi; oauth2?: { initTokenClient(options: Record<string, unknown>): GoogleOAuthTokenClient } } };
  }
}

const GSI_SCRIPT_ID = 'google-identity-services';
const GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

// ---------------------------------------------------------------------
// Stored-credential persistence (the token Google handed over, kept only
// until its exp so a stale one can never be re-exchanged).
// ---------------------------------------------------------------------

export function googleCredentialExpirySeconds(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch { return null; }
}

export function storeGoogleCredential(storageKey: string, credential: string): void {
  window.localStorage.setItem(storageKey, credential);
}

/**
 * The stored credential, iff it is still valid: one past its exp claim
 * (~1h out) is removed on sight - it can no longer authenticate anything,
 * and a stale token left in storage is exactly the "signed in an hour
 * ago, logged out now, and the key silently vanished" fingerprint.
 */
export function restoreStoredGoogleCredential(storageKey: string): string | null {
  const credential = window.localStorage.getItem(storageKey);
  if (!credential) return null;
  const expiry = googleCredentialExpirySeconds(credential);
  if (expiry !== null && expiry <= Math.floor(Date.now() / 1000)) {
    window.localStorage.removeItem(storageKey);
    return null;
  }
  return credential;
}

export function purgeStoredGoogleCredential(storageKey: string): void {
  window.localStorage.removeItem(storageKey);
}

/**
 * Ends GIS auto-select for this origin - the companion to auto_select.
 * An explicit sign-out MUST call this, otherwise the next page load would
 * silently re-authenticate a reader who just chose to leave.
 */
export function disableGoogleAutoSelect(): void {
  // Optional all the way: with GIS missing or only partly loaded (blocked by
  // an extension, still loading) sign-out must still go on to the server
  // logout instead of throwing here.
  window.google?.accounts?.id?.disableAutoSelect?.();
}

/** Request the approved OpenID Connect scopes from GIS and return an access token. */
export function requestGoogleProfileAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const oauth2 = window.google?.accounts.oauth2;
    if (!oauth2) { reject(new Error('Google OAuth client is not ready')); return; }
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: 'openid email profile',
      include_granted_scopes: true,
      callback: (response: { access_token?: string; error?: string }) => {
        if (response.access_token) resolve(response.access_token);
        else reject(new Error(response.error || 'Google profile authorization failed'));
      },
    });
    // An empty prompt reuses a consent decision already granted in Google;
    // GIS may still open a consent dialog when this is the first request.
    client.requestAccessToken({ prompt: '' });
  });
}

// ---------------------------------------------------------------------
// The One Tap controller itself.
// ---------------------------------------------------------------------

export interface GoogleOneTapAuthOptions {
  clientId: string;
  credentialStorageKey: string;
  /** Receives the raw Google ID token; must exchange it with your backend
   *  and, on success, call storeGoogleCredential - see the module header. */
  onCredential: (credential: string) => Promise<void>;
  onError?: (message: string) => void;
  /** Diagnostics hook; default console.debug with a one-tap prefix. */
  log?: (...args: unknown[]) => void;
}

export class GoogleOneTapAuth {
  private readonly log: (...args: unknown[]) => void;
  private scriptLoadPromise: Promise<void> | null = null;
  private initializedForClientId: string | null = null;
  private prompted = false;
  private handlers: Pick<GoogleOneTapAuthOptions, 'onCredential' | 'onError'>;

  constructor(private readonly options: GoogleOneTapAuthOptions) {
    this.log = options.log ?? ((...args: unknown[]) => console.debug('[google-one-tap]', ...args));
    this.handlers = { onCredential: options.onCredential, onError: options.onError };
  }

  /** Components remount; the shared instance outlives them - keep their
   *  current handlers without re-initializing GIS. */
  setHandlers(handlers: Partial<Pick<GoogleOneTapAuthOptions, 'onCredential' | 'onError'>>): void {
    if (handlers.onCredential) this.handlers.onCredential = handlers.onCredential;
    if (handlers.onError) this.handlers.onError = handlers.onError;
  }

  /**
   * The GIS initialize() options - public so the policy is pinnable by a
   * unit test instead of living only inside a component's closure.
   *
   * auto_select: true is what makes one-tap PERSISTENT: a returning
   * visitor with an active Google session is silently re-credentialed on
   * page load, refreshing the stored credential every visit. With it
   * disabled - the bug this policy fixed - the persistence chain was
   * just the backend session cookie plus a ~1h stored token, and every
   * visit more than an hour after the last sign-in landed logged out.
   */
  initializeOptions(clientId: string): Record<string, unknown> {
    return {
      client_id: clientId,
      callback: (response: GoogleCredentialResponse) => { void this.handleCredentialResponse(response); },
      auto_select: true,
      cancel_on_tap_outside: false,
      context: 'signin',
      essential_claims: 'picture',
      itp_support: true,
      // NOT use_fedcm_for_prompt: the FedCM-rendered prompt only appears
      // when the browser profile is signed into Google at the browser
      // level (plus reachable FedCM endpoints, recent Chrome, nothing
      // blocking) - and when any of that fails GIS skips silently, with
      // NO fallback to the classic prompt ("FedCM get() rejects with
      // NetworkError" -> prompt moment skipped, observed on prod). The
      // classic iframe prompt needs only a Google cookie session.
      // Revisit when Google actually makes FedCM mandatory - GIS will
      // say so, not just warn about the status methods.
    };
  }

  private async handleCredentialResponse(response: GoogleCredentialResponse): Promise<void> {
    this.log('credential callback fired', {
      hasCredential: Boolean(response.credential),
      credentialLength: response.credential?.length ?? 0,
      selectBy: response.select_by,
    });
    if (!response.credential) return;
    try {
      await this.handlers.onCredential(response.credential);
      this.log('onCredential handler completed successfully');
    } catch (error) {
      this.log('onCredential handler threw', error);
      this.handlers.onError?.(error instanceof Error ? error.message : 'Google sign-in failed.');
    }
  }

  private loadScript(): Promise<void> {
    if (this.scriptLoadPromise) return this.scriptLoadPromise;
    this.scriptLoadPromise = new Promise((resolve, reject) => {
      if (window.google) { resolve(); return; }
      const existing = document.getElementById(GSI_SCRIPT_ID) as HTMLScriptElement | null;
      if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); return; }
      const script = document.createElement('script');
      script.id = GSI_SCRIPT_ID;
      script.src = GSI_SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Google sign-in could not be loaded.'));
      document.head.appendChild(script);
    });
    return this.scriptLoadPromise;
  }

  /**
   * Loads the GIS script and initializes it for the configured client id,
   * exactly once per id. Resolves immediately (doing nothing) when no
   * client id is configured - sign-in is then simply not offered.
   */
  async ready(): Promise<void> {
    if (!this.options.clientId) {
      this.log('no client id configured - sign-in not offered');
      return;
    }
    try {
      await this.loadScript();
    } catch (error) {
      this.log('script load FAILED', error);
      this.handlers.onError?.(error instanceof Error ? error.message : 'Google sign-in could not be loaded.');
      return;
    }
    this.log('script loaded, initializing');
    if (this.initializedForClientId !== this.options.clientId) {
      window.google!.accounts.id.initialize(this.initializeOptions(this.options.clientId));
      this.initializedForClientId = this.options.clientId;
    }
  }

  /**
   * Google's automatic one-tap prompt - present at most once per instance
   * (one page load). With auto_select on, a returning visitor with an
   * active Google session is silently re-credentialed through this same
   * call, with no visible prompt at all.
   */
  presentPrompt(): void {
    if (this.prompted) return;
    if (!this.options.clientId || !window.google || this.initializedForClientId !== this.options.clientId) return;
    this.prompted = true;
    this.log('calling prompt()');
    window.google.accounts.id.prompt((notification) => {
      this.log('prompt moment notification', {
        momentType: notification.getMomentType?.(),
        isDisplayed: notification.isDisplayed?.(),
        notDisplayedReason: notification.isNotDisplayed?.() ? notification.getNotDisplayedReason?.() : undefined,
        isSkippedMoment: notification.isSkippedMoment?.(),
        skippedReason: notification.isSkippedMoment?.() ? notification.getSkippedReason?.() : undefined,
        isDismissedMoment: notification.isDismissedMoment?.(),
        dismissedReason: notification.isDismissedMoment?.() ? notification.getDismissedReason?.() : undefined,
      });
    });
  }

  /** The explicit "Continue with Google" button (delegates to GIS). */
  renderButton(parent: HTMLElement, buttonOptions: Record<string, unknown>): void {
    window.google?.accounts.id.renderButton(parent, buttonOptions);
  }

  /** The storage key the app chose (re-exposed for its sign-in flows). */
  get credentialStorageKey(): string {
    return this.options.credentialStorageKey;
  }
}
