import { guestLabel, INITIATOR_HEADER, isGuestLabel, receivedLabel } from './initiator';

// The reader's initiator for a browser request. biblioteca-server owns the
// sign-in: it answers every request with the X-Biblioteca-Initiator it
// resolved from its own session, so the reader learns who a JSESSIONID
// belongs to from the responses it relays - no extra lookups. A request
// whose session is not known (yet) is labelled as the guest of its visitor
// cookie, or of its address and browser when it has none.

const SESSION_COOKIE = 'JSESSIONID';

function sessionId(cookieHeader: string | null | undefined): string | undefined {
  for (const part of (cookieHeader || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === SESSION_COOKIE && rest.length) return rest.join('=');
  }
  return undefined;
}

/** The session a response starts, if it sets a new session cookie. */
function startedSessionId(response: Response): string | undefined {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const id = sessionId(cookie.split(';')[0]);
    if (id) return id;
  }
  return undefined;
}

export interface SessionInitiators {
  /** The label for a request with this Cookie header. */
  labelFor(cookieHeader: string | undefined, guestSeed: string): string;
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
    labelFor(cookieHeader, guestSeed) {
      const id = sessionId(cookieHeader);
      return (id && users.get(id)) || guestLabel(guestSeed);
    },
    learn(requestCookieHeader, response) {
      const label = receivedLabel(response.headers.get(INITIATOR_HEADER));
      // a sign-in answers with a new session cookie: the label is its user's
      const id = startedSessionId(response) ?? sessionId(requestCookieHeader);
      if (!label || !id) return;
      if (isGuestLabel(label)) users.delete(id); // signed out, or never signed in
      else remember(id, label);
    },
  };
}
