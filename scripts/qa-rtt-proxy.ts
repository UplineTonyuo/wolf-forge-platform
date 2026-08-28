/**
 * A delaying pass-through in front of local Supabase.
 *
 * Local QA and the deployed preview disagreed about Team latency because a
 * Supabase round trip costs ~1-2 ms on loopback and tens of milliseconds from a
 * Vercel function to a hosted project. A path making six serial round trips is
 * therefore indistinguishable from one making a single round trip when measured
 * locally, and obviously different once deployed.
 *
 * Pointing SUPABASE_URL at this proxy adds a fixed cost to every round trip, so
 * the number of round trips a path makes becomes visible in the measurement.
 * It touches no application code and exists only for QA:
 *
 *   tsx scripts/qa-rtt-proxy.ts            # RTT_MS=45, PORT=54399
 */
import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "54399", 10);
const target = process.env.TARGET ?? "http://127.0.0.1:54321";
const delayMs = Number.parseInt(process.env.RTT_MS ?? "45", 10);
const upstream = new URL(target);

const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", (chunk: Buffer) => chunks.push(chunk));
  request.on("end", () => {
    const body = Buffer.concat(chunks);
    setTimeout(() => {
      const headers = { ...request.headers, host: upstream.host };
      delete headers["content-length"];
      const proxied = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port,
          path: request.url,
          method: request.method,
          headers: body.length > 0 ? { ...headers, "content-length": body.length } : headers,
        },
        (upstreamResponse) => {
          response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
          upstreamResponse.pipe(response);
        },
      );
      proxied.on("error", () => {
        response.writeHead(502);
        response.end();
      });
      if (body.length > 0) proxied.write(body);
      proxied.end();
    }, delayMs);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`rtt-proxy listening on http://127.0.0.1:${port} -> ${target} (+${delayMs}ms per round trip)`);
});
