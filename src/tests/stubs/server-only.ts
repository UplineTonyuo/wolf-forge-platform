/**
 * Test stub for the `server-only` package.
 *
 * `server-only` is not an installed dependency — Next.js resolves it at bundle
 * time to a module that throws if it is ever pulled into a client bundle. Node
 * cannot resolve it at all, so any Vitest suite that imports a module carrying
 * `import "server-only"` would fail on resolution rather than on behaviour.
 *
 * `vitest.config.ts` aliases the specifier here. This stub is intentionally
 * empty and intentionally test-only: it makes the import resolvable, and
 * nothing else. It does NOT weaken the real boundary — the client-bundle guard
 * is enforced by Next during `next build`, and the source-level assertions in
 * the security suites check that the marker is still present in each module.
 */

export {};
