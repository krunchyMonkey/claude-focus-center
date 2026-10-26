// Minimal sequential test harness for code that runs inside the Extension Development Host.
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export type HostTest = [name: string, fn: () => Promise<void>];

export async function runSuite(tests: HostTest[]): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✔ ${name}`);
    } catch (err) {
      failures.push(name);
      console.error(`  ✘ ${name}\n${err instanceof Error ? err.stack : String(err)}`);
    }
  }
  console.log(`${tests.length - failures.length}/${tests.length} host tests passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} host test(s) failed`);
  }
}

/** Runs a script with the extension host's own executable acting as plain Node (like a hook). */
export function runNode(args: string[], input: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('exit', resolve);
    child.stdin.end(input);
  });
}

export async function waitUntil(check: () => boolean | Promise<boolean>, ms = 5000): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (await check()) {
      return Date.now() - started;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`condition not met within ${ms} ms`);
}

/**
 * Records network calls whose stack passes through the extension's compiled code (not tests).
 * Install before the extension activates. Covers module-level APIs, not native bindings.
 */
export function installNetworkTrap(extensionOutDir: string, testDir: string): string[] {
  const calls: string[] = [];
  const ourOut = extensionOutDir.endsWith(path.sep) ? extensionOutDir : extensionOutDir + path.sep;
  const tests = testDir.endsWith(path.sep) ? testDir : testDir + path.sep;
  const fromExtension = (stack: string) => stack.split('\n').some((l) => l.includes(ourOut) && !l.includes(tests));
  const wrap = (mod: Record<string, unknown>, name: string, fn: string) => {
    const original = mod[fn];
    if (typeof original !== 'function') {
      return;
    }
    mod[fn] = function (this: unknown, ...args: unknown[]) {
      if (fromExtension(new Error().stack ?? '')) {
        calls.push(`${name}.${fn}`);
      }
      return (original as (...a: unknown[]) => unknown).apply(this, args);
    };
  };
  for (const [name, fns] of [['http', ['request', 'get']], ['https', ['request', 'get']], ['net', ['connect', 'createConnection']], ['tls', ['connect']], ['dns', ['lookup', 'resolve']]] as const) {
    const mod = require(`node:${name}`) as Record<string, unknown>;
    fns.forEach((fn) => wrap(mod, name, fn));
  }
  wrap(globalThis as unknown as Record<string, unknown>, 'global', 'fetch');
  return calls;
}
