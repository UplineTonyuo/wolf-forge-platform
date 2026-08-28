import "server-only";

export class IntegrationPermissionError extends Error {
  constructor() { super("Integration administration is not permitted."); }
}

export function requireIntegrationManager(canManage: boolean): void {
  if (!canManage) throw new IntegrationPermissionError();
}

