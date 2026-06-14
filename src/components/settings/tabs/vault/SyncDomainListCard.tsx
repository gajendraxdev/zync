import type { ReactNode } from 'react';

interface SyncDomainListCardProps {
  children: ReactNode;
}

/** One bordered card with divided rows — matches Local Vault security list styling. */
export function SyncDomainListCard({ children }: SyncDomainListCardProps) {
  return (
    <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/25 divide-y divide-[var(--color-app-border)]/30">
      {children}
    </div>
  );
}