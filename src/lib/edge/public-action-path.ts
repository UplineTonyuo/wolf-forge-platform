export function isPublicActionPath(pathname: string): boolean {
  return pathname === "/login"
    || pathname.startsWith("/f/")
    || pathname === "/activate"
    // Exit must still clear delegated browser state after the administrator's session expires.
    || pathname === "/client-support/exit";
}
