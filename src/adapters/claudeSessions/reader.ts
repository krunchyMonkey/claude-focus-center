import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Where reading of one transcript stopped. A cursor, not a logical identifier. */
export interface ReadCursor {
  /** Byte offset just after the last consumed newline. */
  offset: number;
  size: number;
  mtimeMs: number;
  /** Bytes examined so far (>= offset when a partial line is held back). */
  readTo: number;
  /** Hash of the first `fingerprintBytes` bytes, to detect a file rewritten in place. */
  fingerprint: string;
  fingerprintBytes: number;
  /** Set while skipping the rest of a line longer than the read budget. */
  discardingLine: boolean;
}

export interface ReadLine {
  /** Byte offset of the line start; diagnostic only. */
  offset: number;
  text: string;
}

export interface ReadResult {
  lines: ReadLine[];
  cursor: ReadCursor;
  /** File size and mtime matched the cursor, so nothing was read. */
  unchanged: boolean;
  /** The file shrank or was rewritten; reading restarted from the beginning. */
  reset: boolean;
  /** More complete data is available beyond this read's byte budget. */
  more: boolean;
  bytesRead: number;
  /** Lines dropped because they exceeded the per-line budget. */
  oversizedLines: number;
}

export interface ReadOptions {
  /** Max bytes per call. */
  maxBytes?: number;
  /** On first read of a large file, start this many bytes before EOF instead of at 0. */
  initialTailBytes?: number;
}

export const DEFAULT_MAX_READ_BYTES = 4 * 1024 * 1024;
export const DEFAULT_INITIAL_TAIL_BYTES = 1024 * 1024;
const FINGERPRINT_BYTES = 256;

/**
 * Reads complete lines appended since `cursor`. A trailing partial line is left for the next call,
 * so a write in progress is never parsed half-way. Unchanged files are not opened.
 */
export async function readAppended(path: string, cursor: ReadCursor | undefined, options: ReadOptions = {}): Promise<ReadResult> {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const initialTail = options.initialTailBytes ?? DEFAULT_INITIAL_TAIL_BYTES;
  const stat = await fs.stat(path);

  // Skip only when the file is unchanged *and* the previous call reached its end.
  if (cursor && stat.size === cursor.size && stat.mtimeMs === cursor.mtimeMs && cursor.readTo >= stat.size) {
    return { lines: [], cursor, unchanged: true, reset: false, more: false, bytesRead: 0, oversizedLines: 0 };
  }

  const handle = await fs.open(path, 'r');
  try {
    let reset = false;
    let start: number;
    let discarding: boolean;
    if (cursor && stat.size >= cursor.offset && (await fingerprint(handle, cursor.fingerprintBytes)) === cursor.fingerprint) {
      start = cursor.offset;
      discarding = cursor.discardingLine;
    } else {
      reset = cursor !== undefined;
      // Cold start of a big file: begin near the end and drop the first (probably partial) line.
      start = !cursor && stat.size > initialTail ? stat.size - initialTail : 0;
      discarding = start > 0;
    }

    const length = Math.min(maxBytes, stat.size - start);
    const buffer = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = length > 0 ? await handle.read(buffer, 0, length, start) : { bytesRead: 0 };
    const data = buffer.subarray(0, bytesRead);

    const lines: ReadLine[] = [];
    let oversizedLines = 0;
    let pos = 0;
    while (pos < data.length) {
      const nl = data.indexOf(0x0a, pos);
      if (nl === -1) {
        break;
      }
      if (discarding) {
        discarding = false;
      } else {
        lines.push({ offset: start + pos, text: data.toString('utf8', pos, nl).replace(/\r$/, '') });
      }
      pos = nl + 1;
    }
    // A full buffer with no newline at all is a single line longer than the budget: skip it.
    if (pos === 0 && data.length === maxBytes && data.length > 0) {
      if (!discarding) {
        oversizedLines++;
      }
      discarding = true;
      pos = data.length;
    }

    const offset = start + pos;
    const fpBytes = Math.min(FINGERPRINT_BYTES, offset);
    return {
      lines,
      cursor: {
        offset,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        readTo: start + bytesRead,
        fingerprint: await fingerprint(handle, fpBytes),
        fingerprintBytes: fpBytes,
        discardingLine: discarding,
      },
      unchanged: false,
      reset,
      more: start + bytesRead < stat.size,
      bytesRead,
      oversizedLines,
    };
  } finally {
    await handle.close();
  }
}

async function fingerprint(handle: fs.FileHandle, bytes: number): Promise<string> {
  if (bytes <= 0) {
    return '';
  }
  const buffer = Buffer.alloc(bytes);
  const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
  return createHash('sha256').update(buffer.subarray(0, bytesRead)).digest('hex');
}
