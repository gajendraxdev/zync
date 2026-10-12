import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { MAX_DISPLAY_ALIAS_LENGTH, parseDisplayAliasDraft } from '../../features/workspace/domain/presentation';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Modal } from '../ui/Modal';
import { Toolbar } from '../ui/Toolbar';

export interface DisplayAliasDialogProps {
    isOpen: boolean;
    /** Override when the caller also supplies other presentation actions. */
    title?: string;
    /** Shared Modal width utility; ordinary rename dialogs keep the default width. */
    width?: string;
    defaultTitle: string;
    displayAlias?: string;
    /** Optional presentation actions; controls inside this form must use type="button". */
    actions?: ReactNode;
    /** Explicit name-only labels when the dialog also contains immediate actions. */
    saveLabel?: string;
    resetLabel?: string;
    dismissLabel?: string;
    /** Synchronous presentation update; the caller owns persistence and resource identity. */
    onSave: (alias: string | undefined) => void;
    onClose: () => void;
}

/** Edit a display-only alias. Key by target identity when switching targets while open. */
export function DisplayAliasDialog({ isOpen, title = 'Rename display name', width, ...props }: DisplayAliasDialogProps) {
    return (
        <Modal isOpen={isOpen} onClose={props.onClose} title={title} width={width} showCloseButton={false}>
            {isOpen && <DisplayAliasForm {...props} />}
        </Modal>
    );
}

/** Mount per opening: changing a live title must not overwrite an in-progress draft. */
export function DisplayAliasForm({ defaultTitle, displayAlias, actions, onSave, onClose,
    saveLabel = 'Save', resetLabel = 'Reset to default', dismissLabel = 'Cancel',
}: Omit<DisplayAliasDialogProps, 'isOpen' | 'title' | 'width'>) {
    const [draft, setDraft] = useState(displayAlias ?? '');
    const [error, setError] = useState<string>();
    const inputId = useId();
    const helpId = `${inputId}-help`;
    const defaultId = `${inputId}-default`;
    const isComposing = useRef(false);
    const completed = useRef(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const save = (alias: string | undefined) => {
        if (completed.current) return;
        completed.current = true;
        try {
            onSave(alias);
        } catch {
            completed.current = false;
            setError('Could not update the display name. Please try again.');
            inputRef.current?.focus();
            return;
        }
        onClose();
    };

    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isComposing.current || completed.current) return;
        const result = parseDisplayAliasDraft(draft);
        if (!result.ok) {
            setError(`Use ${MAX_DISPLAY_ALIAS_LENGTH} characters or fewer.`);
            inputRef.current?.focus();
            return;
        }
        save(result.alias);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <Input
                ref={inputRef}
                id={inputId}
                label="Display name"
                type="text"
                value={draft}
                placeholder={defaultTitle}
                error={error}
                aria-describedby={`${helpId} ${defaultId}`}
                onChange={(event) => { setDraft(event.target.value); setError(undefined); }}
                onCompositionStart={() => { isComposing.current = true; }}
                onCompositionEnd={() => { isComposing.current = false; }}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.nativeEvent.isComposing || isComposing.current)) {
                        event.preventDefault();
                    }
                }}
            />
            <p id={helpId} className="text-xs leading-relaxed text-app-muted">
                This changes only the display label, not host names, files, or connections.
                {' '}Use up to {MAX_DISPLAY_ALIAS_LENGTH} characters. Leave empty to use the default.
            </p>
            <p id={defaultId} className="break-words text-xs text-app-muted">
                Default: <span className="text-app-text">{defaultTitle}</span>
            </p>
            {actions}
            <Toolbar label="Display name actions" className="justify-end">
                <Button type="button" variant="secondary" className="mr-auto" onClick={() => save(undefined)}>
                    {resetLabel}
                </Button>
                <Button type="button" variant="secondary" onClick={onClose}>{dismissLabel}</Button>
                <Button type="submit">{saveLabel}</Button>
            </Toolbar>
        </form>
    );
}
