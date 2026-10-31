const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 10_000;
const MAX_HOSTS = 200;

export class TenantHostCache {
  private readonly entries = new Map<string, { tenantId: string | null; expiresAt: number }>();

  get(host: string): string | null | undefined {
    const entry = this.entries.get(host);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(host);
      return undefined;
    }
    return entry.tenantId;
  }

  set(host: string, tenantId: string | null): void {
    this.entries.delete(host);
    if (this.entries.size >= MAX_HOSTS) {
      this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(host, {
      tenantId,
      expiresAt: Date.now() + (tenantId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
  }
}
