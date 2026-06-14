import { Button } from '../../../ui/Button';
import { Modal } from '../../../ui/Modal';
import { cn } from '../../../../lib/utils';

const CHECKBOX_CLASS =
  'mt-0.5 h-4 w-4 shrink-0 rounded border-[var(--color-app-border)] bg-[var(--color-app-surface)] text-[var(--color-app-accent)] focus:ring-[var(--color-app-accent)]';

interface ConnectionsRestoreBundleModalProps {
  isOpen: boolean;
  onClose: () => void;
  includeTunnels: boolean;
  includeHostSnippets: boolean;
  includeReferencedCredentials: boolean;
  tunnelsEnabled: boolean;
  snippetsEnabled: boolean;
  onIncludeTunnelsChange: (value: boolean) => void;
  onIncludeHostSnippetsChange: (value: boolean) => void;
  onIncludeReferencedCredentialsChange: (value: boolean) => void;
}

function BundleIncludedRow({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex items-start gap-3 px-1 py-2 opacity-90">
      <input
        type="checkbox"
        checked
        disabled
        aria-label={`${label} (always included)`}
        className={CHECKBOX_CLASS}
      />
      <span className="min-w-0">
        <span className="block text-sm text-[var(--color-app-text)]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-[var(--color-app-muted)]">{hint}</span>}
      </span>
    </div>
  );
}

function BundleCheckboxRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex items-start gap-3 rounded-lg px-1 py-2',
        disabled
          ? 'cursor-not-allowed opacity-50'
          : 'cursor-pointer hover:bg-[var(--color-app-surface)]/35',
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={event => onChange?.(event.target.checked)}
        className={CHECKBOX_CLASS}
      />
      <span className="min-w-0">
        <span className="block text-sm text-[var(--color-app-text)]">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-[var(--color-app-muted)]">{hint}</span>}
      </span>
    </label>
  );
}

export function formatRestoreBundleSummary(
  includeTunnels: boolean,
  includeHostSnippets: boolean,
  includeReferencedCredentials: boolean,
  tunnelsEnabled: boolean,
  snippetsEnabled: boolean,
): string {
  const parts = ['host definitions'];
  if (tunnelsEnabled && includeTunnels) parts.push('tunnels');
  if (snippetsEnabled && includeHostSnippets) parts.push('host snippets');
  if (includeReferencedCredentials) parts.push('referenced creds');
  return `Restore includes ${parts.join(', ')}`;
}

export function ConnectionsRestoreBundleModal({
  isOpen,
  onClose,
  includeTunnels,
  includeHostSnippets,
  includeReferencedCredentials,
  tunnelsEnabled,
  snippetsEnabled,
  onIncludeTunnelsChange,
  onIncludeHostSnippetsChange,
  onIncludeReferencedCredentialsChange,
}: ConnectionsRestoreBundleModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Restore options"
      subtitle="Choose what to pull from Drive before restoring. Best for setting up a new device."
      width="max-w-md"
    >
      <div className="space-y-0.5">
        <BundleIncludedRow
          label="Host definitions"
          hint="Always restored — tunnels and snippets need host records on this device"
        />
        <BundleCheckboxRow
          checked={includeTunnels}
          onChange={onIncludeTunnelsChange}
          label="Tunnels for restored hosts"
          hint={tunnelsEnabled ? undefined : 'Tunnels domain is disabled'}
          disabled={!tunnelsEnabled}
        />
        <BundleCheckboxRow
          checked={includeHostSnippets}
          onChange={onIncludeHostSnippetsChange}
          label="Host-scoped snippets"
          hint={snippetsEnabled ? undefined : 'Snippets domain is disabled'}
          disabled={!snippetsEnabled}
        />
        <BundleCheckboxRow
          checked={includeReferencedCredentials}
          onChange={onIncludeReferencedCredentialsChange}
          label="Referenced vault credentials"
          hint="Only creds your hosts point at — not your full vault library"
        />
      </div>
      <div className="mt-5 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Done
        </Button>
      </div>
    </Modal>
  );
}