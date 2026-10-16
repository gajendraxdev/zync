import { useLayoutEffect, useState, type RefObject } from 'react';
import { useLayoutMotion } from '../ui/LayoutMotion';
import { fileListLayoutForWidth, type FileListLayout } from './fileListPresentation';

/** Keep headings and rows in one width tier, settling metadata once after drawer motion. */
export function useFileListLayout(listingRef: RefObject<HTMLDivElement | null>) {
  const { moving } = useLayoutMotion();
  const [tier, setTier] = useState<FileListLayout>('all');
  useLayoutEffect(() => {
    const listing = listingRef.current;
    if (!listing || moving) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width <= 0) return;
      setTier(fileListLayoutForWidth(width));
    });
    observer.observe(listing);
    return () => observer.disconnect();
  }, [listingRef, moving]);
  return tier;
}
