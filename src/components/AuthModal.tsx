import React, { useState } from 'react';
import { X } from 'lucide-react';
import { User } from '../types/textbase';
import { readerService } from '../services/readerService';
import { GoogleOneTap } from './GoogleOneTap';
import { WhoAmI } from '../services/identity';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: User) => void;
  // Real (textbase-server, via Google) session state - separate from the
  // demo currentUser bridge below. reallySignedIn/realUsername are only
  // used here to offer signing back out; onRealGoogleCredential is
  // App.tsx's OWN handleGoogleCredential (the one GoogleOneTapAuto also
  // uses) - routing the explicit Google button below through that same
  // function, instead of this component doing its own separate
  // submitGoogleCredential/fetchWhoAmI round trip, is what makes App's
  // whoAmI state (and therefore the navbar) actually reflect a sign-in
  // that happened via this modal's button - see Navbar.tsx for where
  // that state drives the identity chip.
  reallySignedIn: boolean;
  realUsername?: string;
  realAvatarUrl?: string;
  onRealSignOut: () => Promise<void>;
  onRealGoogleCredential: (credential: string) => Promise<WhoAmI>;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, onSuccess, reallySignedIn, realUsername, realAvatarUrl, onRealSignOut, onRealGoogleCredential }) => {
  const [googleError, setGoogleError] = useState('');
  const [signingOut, setSigningOut] = useState(false);

  if (!isOpen) return null;

  const handleRealSignOutClick = async () => {
    setSigningOut(true);
    try { await onRealSignOut(); }
    finally { setSigningOut(false); }
  };

  // Real Google sign-in - delegates the actual credential exchange to
  // App's own handleGoogleCredential (onRealGoogleCredential) so App's
  // whoAmI state updates from here too, then bridges the result into this
  // app's own demo User/currentUser system so the rest of the UI (nav
  // Collections access, etc.) reflects it as well.
  const handleGoogleCredential = async (credential: string) => {
    let who;
    try {
      who = await onRealGoogleCredential(credential);
    } catch (error) {
      setGoogleError(error instanceof Error ? error.message : 'Google sign-in failed.');
      return;
    }
    const user: User = {
      id: who.username || 'google-user',
      email: who.username || '',
      name: who.username || 'Signed-in reader',
      role: 'reader',
      authProvider: 'google',
      avatar: who.avatarUrl,
    };
    readerService.setUser(user);
    onSuccess(user);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#0b2921] rounded-2xl border border-emerald-500/30 max-w-md w-full p-6 sm:p-8 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
          <div>
            <h3 className="font-display-title text-xl font-bold text-white">
              Textbase Authentication
            </h3>
            <p className="text-xs text-emerald-200/70">
              Sign in to manage personal reading lists and collections.
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 text-emerald-300 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real (Google) identity details - deliberately not shown on the
            navbar chip itself (just the round avatar there), only here on
            tap. */}
        {reallySignedIn && (
          <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/20">
            <div className="flex items-center space-x-3 min-w-0">
              {realAvatarUrl ? (
                <img
                  src={realAvatarUrl}
                  alt={realUsername || 'Signed in'}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 shrink-0 rounded-full border border-amber-500/40 object-cover"
                />
              ) : (
                <div className="w-10 h-10 shrink-0 rounded-full bg-gradient-to-br from-amber-500 to-amber-700 text-black flex items-center justify-center font-bold text-sm">
                  {(realUsername || '?')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-white truncate">
                  {realUsername || 'Signed in'}
                </p>
                <p className="text-[10px] text-emerald-200/60 leading-none">
                  Signed in with Google
                </p>
              </div>
            </div>
            <button
              id="btn-real-signout"
              onClick={handleRealSignOutClick}
              disabled={signingOut}
              title={realUsername ? `Sign out of ${realUsername}` : 'Sign out'}
              className="shrink-0 text-[10px] text-emerald-300/60 hover:text-emerald-300/90 underline decoration-dotted underline-offset-2 disabled:opacity-50 cursor-pointer transition-colors"
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        )}

        {/* PRIMARY SIGN-IN PATH: real Google Identity Services */}
        <div className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-300/60">
            Sign in
          </p>
          <GoogleOneTap onCredential={handleGoogleCredential} onError={setGoogleError} />
          {googleError && <p className="text-xs text-red-400">{googleError}</p>}
        </div>
      </div>
    </div>
  );
};
