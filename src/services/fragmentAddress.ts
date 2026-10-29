/** Shared browser/gateway grammar. Dot steps are structural; only ':' introduces text offsets. */
export interface FragmentLocation {
  sourcePath: string;
  selector: string;
  revision?: string;
  contextOnly?: boolean;
}

export function canonicalSelector(raw: string): string {
  if (raw.length > 1000) throw new Error('Fragment selector is too long');
  const parts = raw.replace(/^_/, '').split('..');
  if (parts.length > 2) throw new Error('Invalid fragment range');
  const points = parts.map(point => {
    if (!/^\d+(?:\.\d+)*(?::\d+)?$/.test(point)) throw new Error('Invalid fragment endpoint');
    const [nodes, offset] = point.split(':');
    const steps = nodes.split('.').map(Number);
    if (steps.length > 64 || steps.some(n => !Number.isSafeInteger(n) || n < 1 || n > 2147483647)) throw new Error('Invalid structural path');
    if (offset !== undefined && (!Number.isSafeInteger(Number(offset)) || Number(offset) > 2147483647)) throw new Error('Invalid text offset');
    return steps.join('.') + (offset === undefined ? '' : ':' + Number(offset));
  });
  if (points.length === 1 && points[0].includes(':')) throw new Error('Text selections need two endpoints');
  return '_' + points.join('..');
}

export function legacyFragmentSelector(start: string, end: string): string {
  const point = (value: string) => {
    if (!/^\d+(?:\.\d+)+$/.test(value)) throw new Error('Invalid legacy fragment boundary');
    const steps = value.split('.');
    return steps.slice(0, -1).join('.') + ':' + steps.at(-1);
  };
  return canonicalSelector('_' + point(start) + '..' + point(end));
}

function sourcePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length < 2 || parts.some(p => p === '.' || p === '..') || !/^[a-z0-9_]+$/.test(parts[0]) ||
      parts.slice(1).some(p => !/^[\p{L}\p{N}_.-]+$/u.test(p))) throw new Error('Invalid fragment source path');
  return parts.join('/');
}

export function parseFragmentLocation(pathname: string, search = ''): FragmentLocation | null {
  if (/^\/(api|assets|src|node_modules|css|img|js|dav)\b/.test(pathname) || /\.(html|txt|xml|json)$/i.test(pathname)) return null;
  const params = new URLSearchParams(search);
  for (const key of ['start', 'end', 'rev', 'display']) if (params.getAll(key).length > 1) throw new Error('Repeated fragment parameter');
  let path = pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/');
  if (path.startsWith('app/reader/')) path = path.slice(11);
  else if (path.startsWith('reader/')) path = path.slice(7);
  if (path.startsWith('app/quote/')) path = path.slice(10);
  else if (path.startsWith('quote/')) path = path.slice(6);
  const extra = { ...(params.has('rev') ? { revision: params.get('rev')! } : {}), ...(params.get('display') === 'context' ? { contextOnly: true } : {}) };
  if (extra.revision !== undefined && !/^[a-f0-9]{64}$/.test(extra.revision)) throw new Error('Invalid source revision');
  if (params.has('start') || params.has('end')) {
    if (!params.has('start') || !params.has('end')) throw new Error('Incomplete fragment range');
    return { sourcePath: sourcePath(path), selector: legacyFragmentSelector(params.get('start')!, params.get('end')!), ...extra };
  }
  const parts = path.split('/');
  const suffix: string[] = [];
  while (parts.length > 2 && /^_\d+(?:[.:].*)?$/.test(parts.at(-1)!)) suffix.unshift(parts.pop()!.slice(1));
  if (!suffix.length) return null;
  // Older vectors can carry /_1/_2/_3. Real divisions are checked by the server.
  return { sourcePath: sourcePath(parts.join('/')), selector: canonicalSelector('_' + suffix.join('.')), ...extra };
}

export function fragmentPath(fragment: FragmentLocation): string {
  const path = sourcePath(fragment.sourcePath).split('/').map(encodeURIComponent).join('/');
  const params = new URLSearchParams();
  if (fragment.revision) params.set('rev', fragment.revision);
  if (fragment.contextOnly) params.set('display', 'context');
  return '/' + path + '/' + canonicalSelector(fragment.selector) + (params.size ? '?' + params : '');
}

/** Exact native selection -> source endpoints, using server-produced mapping spans. */
export function selectionFragment(container: HTMLElement, selection: Selection | null, path: string): FragmentLocation | null {
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const root = container.querySelector<HTMLElement>('[data-fragment-version]');
  if (!root) return null;
  const startElement = range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
  if (range.startContainer === range.endContainer && range.startContainer instanceof Element &&
      range.startOffset === 0 && range.endOffset === range.startContainer.childNodes.length &&
      startElement?.getAttribute('data-source-path')) {
    return { sourcePath: path, selector: canonicalSelector('_' + startElement.getAttribute('data-source-path')), revision: root.dataset.fragmentVersion };
  }
  const point = (node: Node, offset: number, end: boolean) => {
    const element = node instanceof Element ? node : node.parentElement;
    let span = element?.closest<HTMLElement>('[data-fragment-text]');
    let local = offset;
    if (!span) {
      const candidates = [...container.querySelectorAll<HTMLElement>('[data-fragment-text]')];
      const boundary = document.createRange(); boundary.setStart(node, offset); boundary.collapse(true);
      span = (end ? candidates.reverse() : candidates).find(candidate => {
        const r = document.createRange(); r.selectNodeContents(candidate); r.collapse(!end);
        return end ? r.compareBoundaryPoints(Range.START_TO_START, boundary) <= 0 : r.compareBoundaryPoints(Range.START_TO_START, boundary) >= 0;
      });
      local = end ? span?.textContent?.length || 0 : 0;
    } else {
      const prefix = document.createRange(); prefix.selectNodeContents(span); prefix.setEnd(node, offset); local = prefix.toString().length;
    }
    if (!span?.dataset.sourcePath) throw new Error('Selection has no exact source mapping');
    return span.dataset.sourcePath + ':' + (Number(span.dataset.fragmentFrom) - Number(span.dataset.sourceFrom) + local);
  };
  return { sourcePath: path, selector: canonicalSelector('_' + point(range.startContainer, range.startOffset, false) + '..' + point(range.endContainer, range.endOffset, true)), revision: root.dataset.fragmentVersion };
}
