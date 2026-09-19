export { TabDockOverlay } from './TabDockOverlay';
export {
    FILES_OVERLAY_PANE_ID,
    overlayPaneId,
    overlayPluginPaneId,
    parseOverlayFeatureId,
    parseOverlayPluginId,
} from './hit';
export { useDockTabPointer, type DockTabPointerHandlers } from './useDockTabPointer';
export { getTabDockLive, startTabDock, stopTabDock } from './session';
export { splitOpenMenuItems, splitOpenSubmenu, openHerePlacementItems } from './splitOpenItems';
export {
    openFilesHere,
    openTerminalHere,
    canDockHere,
    canSplitBesideFiles,
    filesAlreadyInSplit,
    directoryFromFileLocation,
    isUnconfirmedHomeToken,
    isUnresolvedFilesPath,
    parentDirectory,
    pickFilesHomePath,
    pickFilesOpenPath,
    type OpenHereFile,
} from './openHere';
