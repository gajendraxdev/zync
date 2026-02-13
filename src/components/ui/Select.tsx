import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Command } from 'cmdk';
import { cn } from '../../lib/utils';

export interface SelectOption {
    value: string;
    label: string;
    description?: string;
    icon?: React.ReactNode;
}

interface SelectProps {
    value?: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    label?: string;
    showSearch?: boolean;
    triggerClassName?: string;
    showCheck?: boolean;
    itemClassName?: string;
}

export function Select({ value, onChange, options, placeholder = "Select...", disabled, className, label, showSearch = true, triggerClassName, showCheck = true, itemClassName }: SelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.value === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className={cn("relative w-full", className)} ref={containerRef}>
            {label && (
                <label className="text-xs font-semibold text-app-muted uppercase tracking-wider block mb-2 px-1">
                    {label}
                </label>
            )}
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 rounded-xl border text-sm transition-all duration-200 outline-none",
                    "bg-app-surface/40 text-app-text",
                    isOpen ? "border-app-accent ring-2 ring-app-accent/20 bg-app-surface/60" : "border-app-border/50 hover:border-app-muted hover:bg-app-surface/50",
                    disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                    triggerClassName
                )}
                disabled={disabled}
            >
                <div className="flex-1 flex items-center gap-2 overflow-hidden text-left min-w-0">
                    {selectedOption?.icon && (
                        <div className="flex-none opacity-80">{selectedOption.icon}</div>
                    )}
                    <span className={cn("truncate", !selectedOption && "text-app-muted")}>
                        {selectedOption ? selectedOption.label : placeholder}
                    </span>
                </div>
                <ChevronDown
                    className={cn(
                        "w-4 h-4 text-app-muted transition-transform duration-300 ml-2 scale-90",
                        isOpen && "transform rotate-180 text-app-accent"
                    )}
                />
            </button>

            <AnimatePresence>
                {isOpen && (
                    <motion.div
                        initial={{ opacity: 0, y: 5, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 5, scale: 0.98 }}
                        transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        className="absolute z-[100] w-full mt-2 bg-app-panel border border-app-border shadow-2xl rounded-xl overflow-hidden backdrop-blur-2xl ring-1 ring-white/5"
                    >
                        <Command className="flex flex-col">
                            {showSearch && (
                                <div className="flex items-center border-b border-app-border/50 px-3" cmdk-input-wrapper="">
                                    <Search className="w-4 h-4 text-app-muted/60" />
                                    <Command.Input
                                        autoFocus
                                        placeholder="Search..."
                                        className="w-full h-10 bg-transparent text-sm outline-none px-2 placeholder:text-app-muted/40"
                                    />
                                </div>
                            )}
                            <Command.List className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 scroll-smooth">
                                <Command.Empty className="py-6 text-center text-xs text-app-muted italic">
                                    No matches found.
                                </Command.Empty>

                                {options.map((option) => (
                                    <Command.Item
                                        key={option.value}
                                        value={option.label + " " + (option.description || "")}
                                        onSelect={() => {
                                            onChange(option.value);
                                            setIsOpen(false);
                                        }}
                                        className={cn(
                                            "flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all cursor-pointer select-none",
                                            showCheck ? "pl-2 pr-2" : "px-2",
                                            "aria-selected:bg-app-accent/15 aria-selected:text-app-accent",
                                            value === option.value
                                                ? "bg-app-accent/5 text-app-accent font-medium"
                                                : "text-app-text/90 hover:bg-app-surface",
                                            itemClassName
                                        )}
                                    >
                                        {option.icon && (
                                            <div className="flex-none transition-transform duration-200">
                                                {option.icon}
                                            </div>
                                        )}
                                        <div className="flex-1 overflow-hidden">
                                            <div className="truncate">{option.label}</div>
                                            {option.description && (
                                                <div className="text-[10px] opacity-60 truncate mt-0.5">{option.description}</div>
                                            )}
                                        </div>
                                        {showCheck && option.value === value && (
                                            <motion.div layoutId="check">
                                                <Check className="w-3.5 h-3.5 flex-none" />
                                            </motion.div>
                                        )}
                                    </Command.Item>
                                ))}
                            </Command.List>
                        </Command>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
