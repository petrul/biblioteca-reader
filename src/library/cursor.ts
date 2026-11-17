import type { Entry, EntryList } from './types';
export class ListCursor {
  private indexValue = 0;
  constructor(readonly list: EntryList, index = 0) { this.setIndex(index); }
  get index(): number { return this.indexValue; }
  async current(): Promise<Entry | undefined> { return (await this.list.page(this.indexValue, 1)).entries[0]; }
  setIndex(index: number): void { this.indexValue = Math.max(0, Math.min(index, Math.max(0, (this.list.size ?? 1) - 1))); }
  async next(): Promise<Entry | undefined> { this.setIndex(this.indexValue + 1); return this.current(); }
  async previous(): Promise<Entry | undefined> { this.setIndex(this.indexValue - 1); return this.current(); }
}
