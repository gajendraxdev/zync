import { defaultUrlTransform } from 'react-markdown';
import { rewriteLocalMediaSrc } from './mediaUrls';

/** Keep local media paths; otherwise use react-markdown’s default protocol gate. */
export function releaseNotesUrlTransform(url: string): string {
  return rewriteLocalMediaSrc(url) ?? defaultUrlTransform(url);
}

type HastNode = {
  type?: string;
  tagName?: string;
  properties?: { src?: unknown; poster?: unknown };
  children?: HastNode[];
};

/** Convert `C:\…` / `/tmp/…` `src` attributes to `file:` before sanitizing. */
export function rehypeRewriteLocalMedia() {
  return (tree: HastNode) => {
    const visit = (node: HastNode) => {
      if (node.properties && typeof node.properties.src === 'string') {
        const next = rewriteLocalMediaSrc(node.properties.src);
        if (next) node.properties.src = next;
      }
      if (node.properties && typeof node.properties.poster === 'string') {
        const next = rewriteLocalMediaSrc(node.properties.poster);
        if (next) node.properties.poster = next;
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) visit(child);
      }
    };
    visit(tree);
  };
}
