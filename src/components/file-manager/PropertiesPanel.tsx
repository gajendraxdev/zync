import {
    Calendar,
    File,
    FileCode,
    FileImage,
    FileText,
    Folder,
    HardDrive,
    Info,
    Shield,
    Tag,
    X,
    MapPin
} from 'lucide-react';
import { useMemo } from 'react';
import { cn } from '../../lib/utils';
import { formatBytes, formatDate } from '../../lib/utils'; // Assuming these exist, otherwise I'll use inline or standard Date
import type { FileEntry } from './types';
import { Button } from '../ui/Button';

interface PropertiesPanelProps {
    file: FileEntry | null;
    isOpen: boolean;
    onClose: () => void;
    className?: string;
}

export function PropertiesPanel({ file, isOpen, onClose, className }: PropertiesPanelProps) {
    if (!isOpen || !file) return null;

    const FileIcon = useMemo(() => {
        if (file.type === 'd') return Folder;
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext || '')) return FileImage;
        if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'css', 'html', 'json'].includes(ext || '')) return FileCode;
        if (['txt', 'md', 'log'].includes(ext || '')) return FileText;
        return File;
    }, [file]);

    const permissions = useMemo(() => {
        if (!file.permissions) return 'Unknown';

        // Parse Octal string to rwx
        // e.g. "755" -> "rwxr-xr-x"
        const getPerms = (n: string) => {
            const val = parseInt(n, 10);
            return [
                (val & 4) ? 'r' : '-',
                (val & 2) ? 'w' : '-',
                (val & 1) ? 'x' : '-'
            ].join('');
        };

        const p = file.permissions;
        if (p.length === 3) {
            return `${getPerms(p[0])} ${getPerms(p[1])} ${getPerms(p[2])}`;
        }
        return file.permissions;
    }, [file]);

    const octalPermissions = useMemo(() => {
        // file.permissions is already the octal string from backend (e.g. "755")
        return file.permissions || '000';
    }, [file]);

    return (
        <div
            className={cn(
                "fixed right-0 top-16 bottom-0 w-80 bg-app-panel/95 backdrop-blur-xl border-l border-app-border/50 shadow-2xl z-40 transition-transform duration-300 ease-in-out transform",
                isOpen ? "translate-x-0" : "translate-x-full",
                className
            )}
        >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-app-border/30">
                <h2 className="text-lg font-semibold flex items-center gap-2 text-app-text">
                    <Info size={18} className="text-app-accent" />
                    Properties
                </h2>
                <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8 text-app-muted hover:text-app-text">
                    <X size={18} />
                </Button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto h-[calc(100%-60px)] space-y-8">

                {/* Main Icon & Name */}
                <div className="flex flex-col items-center text-center">
                    <div className={cn(
                        "h-24 w-24 rounded-2xl flex items-center justify-center mb-4 shadow-inner",
                        file.type === 'd' ? "bg-blue-500/10 text-blue-500" : "bg-app-surface text-app-accent"
                    )}>
                        <FileIcon size={48} strokeWidth={1.5} />
                    </div>
                    <h3 className="text-lg font-bold text-app-text break-all px-2 select-text">{file.name}</h3>
                    <p className="text-xs text-app-muted mt-1 font-mono">{file.type === 'd' ? 'Directory' : 'File'}</p>
                </div>

                {/* Info Grid */}
                <div className="space-y-4">

                    {/* Location */}
                    <div className="group">
                        <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-1 gap-1">
                            <MapPin size={12} />
                            <span>Location</span>
                        </div>
                        <p className="text-sm text-app-text/90 break-all select-text font-medium bg-app-surface/50 p-2 rounded-lg border border-transparent group-hover:border-app-border/50 transition-colors">
                            {file.path || 'Unknown'}
                        </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        {/* Size */}
                        <div>
                            <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-1 gap-1">
                                <HardDrive size={12} />
                                <span>Size</span>
                            </div>
                            <p className="text-sm text-app-text/90 font-medium">
                                {file.type === 'd' ? '-' : formatBytes(file.size)}
                            </p>
                        </div>

                        {/* Type */}
                        <div>
                            <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-1 gap-1">
                                <Tag size={12} />
                                <span>Type</span>
                            </div>
                            <p className="text-sm text-app-text/90 font-medium capitalize">
                                {file.type === 'd' ? 'Folder' : file.name.split('.').pop()?.toUpperCase() || 'File'}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        {/* Modified */}
                        <div>
                            <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-1 gap-1">
                                <Calendar size={12} />
                                <span>Modified</span>
                            </div>
                            <p className="text-sm text-app-text/90 font-medium">
                                {formatDate(file.lastModified)}
                            </p>
                        </div>

                        {/* Accessed - Not available in new type yet, use lastModified for now or hide */}
                        <div>
                            <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-1 gap-1">
                                <Calendar size={12} />
                                <span>Accessed</span>
                            </div>
                            <p className="text-sm text-app-text/90 font-medium">
                                -
                            </p>
                        </div>
                    </div>

                    {/* Permissions */}
                    <div className="pt-4 border-t border-app-border/30">
                        <div className="flex items-center text-app-muted text-xs uppercase font-bold tracking-wider mb-2 gap-1">
                            <Shield size={12} />
                            <span>Permissions</span>
                        </div>

                        <div className="bg-app-surface/50 rounded-lg p-3 flex items-center justify-between border border-app-border/20">
                            <div>
                                <span className="text-xs text-app-muted block mb-0.5">Owner / Group / Other</span>
                                <span className="text-sm font-mono text-app-text tracking-widest">{permissions}</span>
                            </div>
                            <div className="text-right">
                                <span className="text-xs text-app-muted block mb-0.5">Octal</span>
                                <span className="text-lg font-bold text-app-accent font-mono">{octalPermissions}</span>
                            </div>
                        </div>

                    </div>

                </div>
            </div>
        </div>
    );
}
