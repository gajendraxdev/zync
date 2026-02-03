import { ChevronLeft, ChevronRight, LayoutGrid, LayoutList } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { useAppStore } from '../../store/useAppStore';

interface FileBottomToolbarProps {
    onBack: () => void;
    onForward: () => void;
    viewMode: 'grid' | 'list';
    onToggleView: (mode: 'grid' | 'list') => void;
    canGoBack?: boolean;
    canGoForward?: boolean;
}

export function FileBottomToolbar({
    onBack,
    onForward,
    viewMode,
    onToggleView,
    canGoBack = true,
    canGoForward = true,
}: FileBottomToolbarProps) {
    const settings = useAppStore((state) => state.settings);
    const compactMode = settings.compactMode;

    return (
        <div className={cn(
            "border-t border-app-border/10 bg-app-panel/95 backdrop-blur-xl flex items-center justify-between px-2 shrink-0 z-20 relative transition-all",
            compactMode ? "h-10" : "h-12"
        )}>
            {/* History Controls */}
            <div className="flex items-center">
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canGoBack}
                    className={cn(
                        "rounded-lg text-app-muted hover:text-app-text disabled:opacity-20 transition-colors",
                        compactMode ? "h-8 w-10" : "h-9 w-12"
                    )}
                    onClick={onBack}
                >
                    <ChevronLeft size={compactMode ? 18 : 20} className="shrink-0" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    disabled={!canGoForward}
                    className={cn(
                        "rounded-lg text-app-muted hover:text-app-text disabled:opacity-20 transition-colors",
                        compactMode ? "h-8 w-10" : "h-9 w-12"
                    )}
                    onClick={onForward}
                >
                    <ChevronRight size={compactMode ? 18 : 20} className="shrink-0" />
                </Button>
            </div>

            {/* View Mode Toggles */}
            <div className="flex items-center mr-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "rounded-lg transition-all",
                        viewMode === 'grid' ? "text-app-accent" : "text-app-muted hover:text-app-text",
                        compactMode ? "h-8 w-8" : "h-9 w-9"
                    )}
                    onClick={() => onToggleView('grid')}
                >
                    <LayoutGrid size={compactMode ? 16 : 18} />
                </Button>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn(
                        "rounded-lg transition-all ml-0.5",
                        viewMode === 'list' ? "text-app-accent" : "text-app-muted hover:text-app-text",
                        compactMode ? "h-8 w-8" : "h-9 w-12"
                    )}
                    onClick={() => onToggleView('list')}
                >
                    <LayoutList size={compactMode ? 16 : 18} />
                </Button>
            </div>
        </div>
    );
}
