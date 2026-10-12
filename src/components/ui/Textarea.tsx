import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';
import { CONTROL_BASE_CLASSES, CONTROL_LABEL_CLASSES } from './controlStyles.js';
import { fieldDescriptionIds } from './fieldAccessibility.js';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
}

/** Native multiline field; its owner controls value, validation and submission. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
  className,
  label,
  error,
  id,
  'aria-describedby': describedBy,
  'aria-invalid': ariaInvalid,
  ...props
}, ref) => {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;

  return (
    <div className="w-full space-y-1">
      {label && <label htmlFor={fieldId} className={CONTROL_LABEL_CLASSES}>{label}</label>}
      <textarea
        ref={ref}
        id={fieldId}
        data-zync-color="control"
        aria-invalid={error ? true : ariaInvalid}
        aria-describedby={fieldDescriptionIds(describedBy, error ? errorId : undefined)}
        className={cn(
          CONTROL_BASE_CLASSES,
          'block min-h-[var(--zync-control-height-md)] w-full resize-y border border-app-border bg-app-surface/50 px-3.5 py-2 text-app-text placeholder:text-app-muted focus-visible:border-control-focus drag-none hover:border-app-muted',
          error && 'border-control-danger focus-visible:ring-control-danger focus-visible:border-control-danger',
          className,
        )}
        {...props}
      />
      {error && <span id={errorId} className="text-xs text-control-danger">{error}</span>}
    </div>
  );
});
Textarea.displayName = 'Textarea';
