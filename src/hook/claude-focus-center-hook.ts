// Claude Code hook entry point, copied (with its sibling modules) to Focus Center's global storage
// and registered as an async exec-form hook:
//   node claude-focus-center-hook.js <EventName> <spoolDir>
// Contract: never block Claude, never make a decision, never print, always exit 0.
// Keep this folder dependency-free: it runs outside VS Code with whatever node is installed.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { toSpoolRecord } from './spoolRecord';

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_SPOOL_FILES = 10_000;

function main(): void {
  const [, , eventArg, spoolArg] = process.argv;
  const spoolDir = spoolArg && path.isAbsolute(spoolArg) ? spoolArg : path.join(__dirname, '..', 'spool');
  const chunks: Buffer[] = [];
  let size = 0;
  let tooLarge = false;

  process.stdin.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) {
      tooLarge = true;
    } else {
      chunks.push(chunk);
    }
  });
  process.stdin.on('end', () => {
    if (!tooLarge) {
      write(spoolDir, Buffer.concat(chunks).toString('utf8'), eventArg);
    }
    process.exit(0);
  });
  process.stdin.on('error', () => process.exit(0));
  // Safety net: never linger even if stdin is never closed.
  setTimeout(() => process.exit(0), 5000).unref();
}

function write(spoolDir: string, raw: string, eventArg: string | undefined): void {
  try {
    const record = toSpoolRecord(raw, eventArg, new Date());
    if (!record) {
      return;
    }
    fs.mkdirSync(spoolDir, { recursive: true });
    // Bound disk use if VS Code is not running to consume events for a long time.
    if (fs.readdirSync(spoolDir).length >= MAX_SPOOL_FILES) {
      return;
    }
    const name = `${Date.now()}-${record.id.slice(0, 16)}.json`;
    const tmp = path.join(spoolDir, `.tmp-${process.pid}-${name}`);
    // Write then rename, so the consumer never sees a partial file.
    fs.writeFileSync(tmp, JSON.stringify(record), { flag: 'wx' });
    fs.renameSync(tmp, path.join(spoolDir, name));
  } catch {
    // Unavailable storage must never affect Claude.
  }
}

main();
