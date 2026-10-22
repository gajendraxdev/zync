/** Explain only recognizable failures; preserve the original message separately for diagnostics. */
export function connectionFailureSummary(message: string): string {
    if (/SSH user certificate has expired/i.test(message)) {
        return 'Certificate expired. Renew it and select the updated certificate.';
    }
    if (/SSH user certificate does not match/i.test(message)) {
        return 'Certificate and private key do not match. Select a matching pair.';
    }
    if (/connection refused|actively refused|os error (?:10061|111|61)\b/i.test(message)) {
        return 'Connection refused. Check the host, port and whether the SSH server is running.';
    }
    if (/timed out|timeout|os error 10060\b/i.test(message)) {
        return 'Connection timed out. Check the network, firewall and selected adapter.';
    }
    if (/authentication failed|authentication rejected/i.test(message)) {
        return 'Authentication failed. Check the remote username and selected credential.';
    }
    return 'Could not verify this connection. Review the details below.';
}

/** Prefer a readable IPv4 address without hiding or changing the adapter's other addresses. */
export function orderedInterfaceAddresses(addresses: readonly string[]): string[] {
    return [...new Set(addresses)].sort((left, right) => Number(left.includes(':')) - Number(right.includes(':')));
}
