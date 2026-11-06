// This preload is only for the disposable compiled-app transport acceptance.
if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true" || process.platform !== "linux") throw new Error("Provider stub requires disposable GitHub Linux CI");
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "api.daily.co" || url.hostname.endsWith(".daily.co")) throw new Error("Daily requests are forbidden by the isolated transport stub");
  return originalFetch(input, init);
};
