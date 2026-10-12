import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toolbar } from '../../ui/Toolbar';

export interface FontStackFieldProps {
    id?: string;
    label: string;
    value: string;
    placeholder: string;
    monospace?: boolean;
    onChange: (value: string) => void;
    onApply: () => void;
}

/** Shared font-stack editor; callers own draft validation and settings persistence. */
export function FontStackField({
    id,
    label,
    value,
    placeholder,
    monospace = false,
    onChange,
    onApply,
}: FontStackFieldProps) {
    return (
        <Toolbar label={`${label} controls`} className="items-end gap-2">
            <div className="min-w-0 flex-[1_1_12rem]">
                <Input
                    id={id}
                    label={label}
                    type="text"
                    value={value}
                    onChange={(event) => { onChange(event.target.value); }}
                    onKeyDown={(event) => {
                        if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                            event.stopPropagation();
                        }
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            onApply();
                        }
                    }}
                    placeholder={placeholder}
                    className={monospace ? 'font-mono' : undefined}
                />
            </div>
            <Button type="button" variant="secondary" onClick={onApply} className="shrink-0">
                Apply
            </Button>
        </Toolbar>
    );
}
