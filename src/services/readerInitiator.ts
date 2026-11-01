import { ANONYMOUS_INITIATOR, GUEST_COOKIE, INITIATOR_HEADER, isGuestName, isUserLabel, receivedLabel } from './initiator';

// The reader's initiator for a browser request. biblioteca-server owns the
// sign-in: it answers every request with the X-Biblioteca-Initiator it
// resolved from its own session, so the reader learns who a JSESSIONID
// belongs to from the responses it relays - no extra lookups. A request
// whose session is not known (yet) is labelled with the browser's guest
// name (the bib_guest cookie), else as anonymous.

const SESSION_COOKIE = 'JSESSIONID';

function cookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  for (const part of (cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name && rest.length) return rest.join('=');
  }
  return undefined;
}

const sessionId = (cookieHeader: string | null | undefined) => cookie(cookieHeader, SESSION_COOKIE);

/** The browser's guest name, if its bib_guest cookie holds one. */
export function guestNameOf(cookieHeader: string | null | undefined): string | undefined {
  const guest = cookie(cookieHeader, GUEST_COOKIE);
  return isGuestName(guest) ? guest : undefined;
}

/** The session a response starts, if it sets a new session cookie. */
function startedSessionId(response: Response): string | undefined {
  for (const setCookie of response.headers.getSetCookie?.() ?? []) {
    const id = sessionId(setCookie.split(';')[0]);
    if (id) return id;
  }
  return undefined;
}

export interface SessionInitiators {
  /** The label for a request with this Cookie header. */
  labelFor(cookieHeader: string | undefined): string;
  /** Records what biblioteca-server said about a request's session. */
  learn(requestCookieHeader: string | null, response: Response): void;
}

export function createSessionInitiators(limit = 10_000): SessionInitiators {
  const users = new Map<string, string>();
  const remember = (id: string, user: string) => {
    users.delete(id);
    users.set(id, user);
    if (users.size > limit) users.delete(users.keys().next().value!);
  };
  return {
    labelFor(cookieHeader) {
      const id = sessionId(cookieHeader);
      return (id && users.get(id)) || guestNameOf(cookieHeader) || ANONYMOUS_INITIATOR;
    },
    learn(requestCookieHeader, response) {
      const label = receivedLabel(response.headers.get(INITIATOR_HEADER));
      // a sign-in answers with a new session cookie: the label is its user's
      const id = startedSessionId(response) ?? sessionId(requestCookieHeader);
      if (!label || !id) return;
      if (isUserLabel(label)) remember(id, label);
      else users.delete(id); // signed out, or never signed in
    },
  };
}
