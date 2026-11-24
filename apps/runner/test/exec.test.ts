import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { run } from '../src/exec';

describe('run', () => {
  it('lets the runner answer its own child meanwhile, as the record token server answers git', async () => {
    const server = createServer((_req, res) => res.end('token'));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address() as AddressInfo;
    try {
      // The child exits 0 only when it got the answer within two seconds, as git's helper must.
      const asks = `fetch('http://127.0.0.1:${port}/', { signal: AbortSignal.timeout(2000) })
        .then((r) => r.text()).then((t) => process.exit(t === 'token' ? 0 : 1), () => process.exit(2))`;
      await expect(run(process.execPath, ['-e', asks])).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });

  it('rejects with the exit code', async () => {
    await expect(run(process.execPath, ['-e', 'process.exit(3)'])).rejects.toThrow(/failed \(3\)/);
  });
});
