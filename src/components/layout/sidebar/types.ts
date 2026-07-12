import type { Connection } from '../../../store/useAppStore';
import type { HostLocationTag } from '../../../features/connections/domain/hostCatalog';

export interface TreeNode {
    name: string;
    path: string;
    children: { [key: string]: TreeNode };
    connections: Connection[];
    folderTags?: string[];
}

export interface ConnectionItemProps {
    onEdit: (conn: Connection) => void;
    onOpenContextMenu: (conn: Connection, x: number, y: number) => void;
    /** Optional multi-location chips by connection / logical id. */
    getLocations?: (conn: Connection) => HostLocationTag[] | undefined;
}
