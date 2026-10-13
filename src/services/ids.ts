/** Collections and their entries are identified by UUIDs, as on the server. */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
