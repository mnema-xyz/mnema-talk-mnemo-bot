// A tiny HTTP endpoint for container health checks and monitoring.
//   GET /healthz  200 while connected to Mnema Talk, 503 otherwise
//   GET /readyz   the same (kept for orchestrators that ask for both)
// The answer holds state and counters only, never content or secrets.
import { createServer, type Server } from 'node:http'

export interface HealthState {
  connected: () => boolean
  details: () => Record<string, unknown>
}

export function startHealthServer(host: string, port: number, state: HealthState): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]
    if (req.method !== 'GET' || (path !== '/healthz' && path !== '/readyz')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found\n')
      return
    }
    const ok = state.connected()
    res
      .writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      .end(JSON.stringify({ status: ok ? 'ok' : 'disconnected', ...state.details() }) + '\n')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve(server)
    })
  })
}
