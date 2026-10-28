/** Browser API requests must stay on the Reader origin and never follow redirects. */
export const sameOriginFetch: typeof fetch = async (input, init) => {
  const origin = globalThis.location?.origin;
  if (origin) {
    const target = input instanceof Request ? input.url : String(input);
    if (new URL(target, origin).origin !== origin) {
      throw new TypeError('Reader API requests must use the same origin');
    }
  }
  return globalThis.fetch(input, {
    ...init,
    credentials: 'same-origin',
    redirect: 'error',
  });
};
