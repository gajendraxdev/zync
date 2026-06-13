export const isVaultLockedError = (message: string): boolean => {
    const normalized = message.toLowerCase();
    return normalized.includes('vault is locked')
        || normalized.includes('[vault_locked]')
        || normalized.includes('needs an unlocked vault')
        || normalized.includes('unlock the vault')
        || normalized.includes('unlock vault');
};

export const vaultStatusNeedsUnlock = (
    status: { status: string } | null | undefined,
): boolean => status?.status === 'locked';