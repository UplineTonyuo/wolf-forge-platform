import { clientSupportOperationAllowed } from "../../domain/auth/client-support-operations";

/** Delegation is a Data API boundary; Auth writes and Storage must not inherit it. */
export function clientSupportFetch(providerUrl: string): typeof fetch {
  const providerOrigin = new URL(providerUrl).origin;
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const dataApi = url.pathname.startsWith("/rest/v1/") && clientSupportOperationAllowed(url.pathname, method);
    const claimVerification = method === "GET" && (url.pathname === "/auth/v1/user" || url.pathname === "/auth/v1/.well-known/jwks.json");
    if (url.origin !== providerOrigin || (!dataApi && !claimVerification)) {
      return Promise.reject(new Error("This operation is unavailable during client support."));
    }
    return fetch(input, init);
  };
}
