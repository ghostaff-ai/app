// Runs a command without blocking the runner's event loop. The runner serves the record's token to
// git's credential helper from its own process (main.ts, serveRecordToken), so a command that may ask
// for it (a clone, a fetch, a push) must never run with spawnSync: the helper's request would wait,
// unanswered, until it times out, and git would go on without credentials (beta, 2026-11-24).

import { spawn, type SpawnOptions } from 'node:child_process';

/** Resolves when `command` exits 0; rejects with its exit code or signal otherwise. */
export function run(command: string, args: string[], opts: SpawnOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    child.on('error', reject);
    child.on('close', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${[command, args[0]].filter(Boolean).join(' ')} failed (${code ?? signal})`)),
    );
  });
}
