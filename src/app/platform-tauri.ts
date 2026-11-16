// Implementação da plataforma com comandos nativos (src-tauri/src/lib.rs).
import { invoke } from '@tauri-apps/api/core';
import type { Platform } from '../core/platform.ts';

export const tauriPlatform: Platform = {
  readData: (name) => invoke<string | null>('data_read', { name }),
  writeData: (name, text) => invoke<void>('data_write', { name, text }),
  appendData: (name, text) => invoke<void>('data_append', { name, text }),
  rotateData: (name, maxBytes) => invoke<void>('data_rotate', { name, maxBytes }),
  localRequest: (req) => invoke('local_request', { req: { method: 'GET', ...req } }),
  leagueProcess: () => invoke('league_process'),
  readLockfile: (paths) => invoke<string | null>('read_lockfile', { paths }),
  sleep: (ms) => invoke<void>('sleep_ms', { ms: Math.max(0, Math.round(ms)) })
};
