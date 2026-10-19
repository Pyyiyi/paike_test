export function normalizeIp(value: string | undefined | null): string {
  if (!value) {
    return '0.0.0.0';
  }
  const trimmed = value.trim();
  if (trimmed === '::1' || trimmed === '::ffff:127.0.0.1') {
    return '127.0.0.1';
  }
  if (trimmed.startsWith('::ffff:')) {
    return trimmed.slice(7);
  }
  return trimmed;
}
