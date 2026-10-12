import { useEffect, useRef, useState } from 'react';
import { GoogleOneTapAuth } from '../services/googleOneTapAuth';

// The React wiring around the reusable one-tap module
// (services/googleOneTapAuth.ts - framework-free, copyable to other UI
// services). One shared instance lives for the whole app; the two
// components below only (re)point its handlers, load it, and drive the
// prompt/button - all GIS specifics live in the module.
const STORED_GOOGLE_CREDENTIAL_KEY = 'biblioteca.reader.googleCredential.v1';

let sharedOneTap: GoogleOneTapAuth | null = null;

/** Rendering policy shared with App and covered by a regression test. */
export function googleIdentityPresentation(reallySignedIn: boolean | null): { rendered: boolean; presentPrompt: boolean } {
  if (reallySignedIn === null) return { rendered: false, presentPrompt: false };
  return { rendered: true, presentPrompt: reallySignedIn === false };
}

// The app's handlers return Promise<unknown> (App.tsx's handleGoogleCredential
// returns a WhoAmI); the module's contract is Promise<void> - bridge once.
const voidCredentialHandler = (onCredential: (credential: string) => Promise<unknown>) =>
  async (credential: string): Promise<void> => { await onCredential(credential); };

function oneTap(onCredential: (credential: string) => Promise<unknown>, onError: (message: string) => void): GoogleOneTapAuth {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  if (!sharedOneTap) {
    sharedOneTap = new GoogleOneTapAuth({
      clientId: clientId ?? '',
      credentialStorageKey: STORED_GOOGLE_CREDENTIAL_KEY,
      onCredential: voidCredentialHandler(onCredential),
      onError,
    });
  } else {
    sharedOneTap.setHandlers({ onCredential: voidCredentialHandler(onCredential), onError });
  }
  return sharedOneTap;
}

function useGoogleIdentity(onCredential: (credential: string) => Promise<unknown>, onError: (message: string) => void) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  const instance = oneTap(onCredential, onError);
  const [ready, setReady] = useState(false);

  useEffect(() => { instance.setHandlers({ onCredential: voidCredentialHandler(onCredential), onError }); }, [onCredential, onError]);

  useEffect(() => {
    if (!clientId) {
      console.debug('[google-one-tap] no VITE_GOOGLE_CLIENT_ID configured - sign-in not offered');
      return;
    }
    let cancelled = false;
    console.debug('[google-one-tap] loading Google Identity Services script');
    instance.ready()
      .then(() => {
        if (cancelled) return;
        console.debug('[google-one-tap] ready');
        setReady(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  return { ready, clientId };
}

/**
 * Mount once, unconditionally, whenever the reader isn't signed in (see
 * App.tsx) - triggers Google's own automatic one-tap prompt. Renders
 * nothing itself; the floating prompt UI is Google's own. With auto_select
 * on (the module's policy), a returning visitor with an active Google
 * session is silently re-credentialed through the same prompt call.
 */
export function GoogleOneTapAuto({ onCredential, onError, onReady, presentPrompt = true }: { onCredential: (credential: string) => Promise<unknown>; onError: (message: string) => void; onReady?: () => void; presentPrompt?: boolean }) {
  const { ready, clientId } = useGoogleIdentity(onCredential, onError);
  const readyCallbackRun = useRef(false);

  useEffect(() => {
    if (!ready || !clientId) return;
    if (!readyCallbackRun.current) {
      readyCallbackRun.current = true;
      onReady?.();
    }
    if (!presentPrompt) return;
    console.debug('[google-one-tap] presenting the automatic prompt');
    oneTap(onCredential, onError).presentPrompt();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, clientId, onReady, presentPrompt]);

  return null;
}

/** The explicit "Continue with Google" button, e.g. inside AuthModal. */
export function GoogleOneTap({ onCredential, onError }: { onCredential: (credential: string) => Promise<unknown>; onError: (message: string) => void }) {
  const buttonRef = useRef<HTMLDivElement>(null);
  const { ready } = useGoogleIdentity(onCredential, onError);

  useEffect(() => {
    if (!ready || !buttonRef.current) return;
    console.debug('[google-one-tap] rendering explicit Continue-with-Google button');
    buttonRef.current.replaceChildren();
    oneTap(onCredential, onError).renderButton(buttonRef.current, {
      type: 'standard', theme: 'outline', size: 'large', shape: 'pill',
      text: 'continue_with', width: Math.min(360, buttonRef.current.clientWidth || 320),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return <div className="google-one-tap" data-testid="google-one-tap">
    <div ref={buttonRef} aria-label="Continue with Google" />
    {!ready && <span>Loading Google sign-in…</span>}
  </div>;
}
