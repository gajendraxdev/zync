import type { RefObject } from 'react';

import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';

interface GoToLinePanelProps {
  error: string | null;
  inputRef: RefObject<HTMLInputElement | null>;
  maxLine: number;
  value: string;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export function GoToLinePanel({
  error,
  inputRef,
  maxLine,
  value,
  onCancel,
  onChange,
  onSubmit,
}: GoToLinePanelProps) {
  return (
    <>
      <div className="flex items-center gap-2 border-b border-app-border bg-app-surface/30 px-3 py-1.5">
        <Input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDownCapture={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onSubmit();
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          placeholder={`Go to line (1-${maxLine}) or line:column`}
          className="h-8"
        />

        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" type="button" onClick={onSubmit}>
          Go
        </Button>
      </div>

      {error && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          {error}
        </div>
      )}
    </>
  );
}
