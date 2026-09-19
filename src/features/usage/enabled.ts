let enabled = true;

export function setUsageEnabled(value: boolean): void {
  enabled = value;
}

export function isUsageEnabled(): boolean {
  return enabled;
}
