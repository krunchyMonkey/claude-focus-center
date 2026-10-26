import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FocusCenterApi } from '../../extension';
import type { FocusNode } from '../../ui/nodes';
import { runNode } from '../harness';
import { goldPathLayout } from './fixture';

export const EXTENSION_ID = 'krunchymonkey.claude-focus-center';
export const HOOK_SCRIPT = path.resolve(__dirname, '..', '..', 'hook', 'claude-focus-center-hook.js');

export function layout() {
  const root = process.env.FOCUS_CENTER_ACCEPTANCE_ROOT;
  assert.ok(root, 'FOCUS_CENTER_ACCEPTANCE_ROOT not set');
  return goldPathLayout(root);
}

export async function activate(): Promise<FocusCenterApi> {
  const ext = vscode.extensions.getExtension<FocusCenterApi>(EXTENSION_ID);
  assert.ok(ext);
  return ext.activate();
}

/** Group label → count, as shown in the sidebar. */
export function dashboard(api: FocusCenterApi): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of api.getRootNodes()) {
    out[g.id.replace('group:', '')] = Number(g.description ?? 0);
  }
  return out;
}

export function itemNodes(api: FocusCenterApi): FocusNode[] {
  return api.getRootNodes().flatMap((g) => g.children ?? []).flatMap((w) => w.children ?? []).filter((n) => n.itemId);
}

export async function fireHook(api: FocusCenterApi, hook: { event: string; payload: object }): Promise<void> {
  assert.equal(await runNode([HOOK_SCRIPT, hook.event, api.spoolDir], JSON.stringify(hook.payload)), 0);
}

export function log(line: string): void {
  console.log(`    ${line}`);
}
