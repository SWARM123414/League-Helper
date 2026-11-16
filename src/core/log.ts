// Registo de erros e avisos (em memória + ficheiro), para diagnosticar problemas.
import { platform } from './platform.ts';

const MAX = 400;
const FILE = 'lol-scout.log';

export interface LogEntry {
  t: string;
  level: 'info' | 'warn' | 'error';
  src: string;
  msg: string;
  count?: number;
}

const entries: LogEntry[] = [];
let toFile = false;
let pending: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export async function init(): Promise<void> {
  toFile = true;
  // mantém o ficheiro pequeno
  try { await platform().rotateData(FILE, 512 * 1024); } catch { /* ignora */ }
}

function flush(): void {
  flushTimer = null;
  if (!pending.length) return;
  const text = pending.join('');
  pending = [];
  platform().appendData(FILE, text).catch(() => { /* sem disco */ });
}

function write(level: LogEntry['level'], src: string, msg: unknown): void {
  const m = msg as any;
  const e: LogEntry = { t: new Date().toISOString(), level, src, msg: String(m && m.stack ? m.message : m).slice(0, 1000) };
  // não repetir a mesma mensagem em loop
  const last = entries[entries.length - 1];
  if (last && last.msg === e.msg && last.src === e.src) { last.count = (last.count || 1) + 1; last.t = e.t; return; }
  entries.push(e);
  if (entries.length > MAX) entries.shift();
  if (toFile) {
    // junta as linhas e escreve de uma vez (menos acessos ao disco)
    pending.push(`${e.t} [${level}] ${src}: ${e.msg}\n`);
    if (!flushTimer) flushTimer = setTimeout(flush, 1000);
  }
}

export const info = (src: string, msg: unknown): void => write('info', src, msg);
export const warn = (src: string, msg: unknown): void => write('warn', src, msg);
export const error = (src: string, msg: unknown): void => write('error', src, msg);
export const all = (): LogEntry[] => entries.slice();
export const text = (): string => entries.map((e) => `${e.t} [${e.level}] ${e.src}: ${e.msg}${e.count ? ` (x${e.count})` : ''}`).join('\n');
export const clear = (): void => { entries.length = 0; };
export const flushNow = (): void => { if (flushTimer) clearTimeout(flushTimer); flush(); };
