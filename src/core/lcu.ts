// Ligação ao cliente do League of Legends (LCU API) e à Live Client Data API.
// O cliente expõe uma API local em https://127.0.0.1:<porta> com um certificado
// próprio da Riot. A porta e a password vêm da linha de comandos do processo
// LeagueClientUx.exe ou do "lockfile" na pasta do jogo.

import { platform } from './platform.ts';
import * as log from './log.ts';

const LOCKFILE_CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'E:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'D:\\Games\\Riot Games\\League of Legends\\lockfile'
];

export interface Credentials {
  pid?: number;
  port: number;
  password: string;
  protocol: string;
  installDir?: string | null;
}

export interface LcuError extends Error {
  status?: number;
  body?: any;
  code?: string;
}

export function parseLockfile(text: string): Credentials | null {
  // formato: LeagueClient:<pid>:<porta>:<password>:https
  const parts = String(text || '').trim().split(':');
  if (parts.length < 5) return null;
  return { pid: Number(parts[1]), port: Number(parts[2]), password: parts[3], protocol: parts[4] };
}

export function parseCommandLine(cmd: string): Credentials | null {
  const port = /--app-port=(\d+)/.exec(cmd);
  const token = /--remoting-auth-token=([\w-]+)/.exec(cmd);
  const dir = /--install-directory=([^"]+?)(?:"|\s--|$)/.exec(cmd);
  if (!port || !token) return null;
  return {
    port: Number(port[1]),
    password: token[1],
    protocol: 'https',
    installDir: dir ? dir[1].trim() : null
  };
}

const joinPath = (dir: string, file: string) => dir.replace(/[\\/]+$/, '') + '\\' + file;

async function findCredentials(customDir: string | null): Promise<Credentials | null> {
  // 1) Processo em execução (mais fiável, funciona com qualquer pasta de instalação)
  const proc = await platform().leagueProcess().catch(() => ({ cmdline: '', exeDir: null }));
  const fromCmd = proc.cmdline ? parseCommandLine(proc.cmdline) : null;
  if (fromCmd) return fromCmd;

  // 2) Lockfile na pasta indicada nas definições, na pasta do processo ou nas habituais
  const candidates: string[] = [];
  if (customDir) candidates.push(joinPath(customDir, 'lockfile'));
  if (proc.exeDir) candidates.push(joinPath(proc.exeDir, 'lockfile'));
  candidates.push(...LOCKFILE_CANDIDATES);
  const text = await platform().readLockfile(candidates).catch((): string | null => null);
  return text ? parseLockfile(text) : null;
}

async function rawRequest({ port, method = 'GET', pathname, auth, body, timeout = 6000 }:
  { port: number; method?: string; pathname: string; auth?: string; body?: unknown; timeout?: number }): Promise<any> {
  let res;
  try {
    res = await platform().localRequest({ port, method, path: pathname, auth, body, timeoutMs: timeout });
  } catch (err) {
    const msg = String((err as any)?.message ?? err);
    const e: LcuError = new Error(msg);
    if (msg === 'ECONNREFUSED' || msg === 'timeout') e.code = msg;
    throw e;
  }
  if (res.status >= 200 && res.status < 300) return res.body;
  const e: LcuError = new Error(`HTTP ${res.status} em ${pathname}`);
  e.status = res.status;
  e.body = res.body;
  throw e;
}

export interface LcuLike {
  connected: boolean;
  customDir: string | null;
  creds?: Credentials | null;
  connect(): Promise<boolean>;
  disconnect(): void;
  get(p: string): Promise<any>;
  post(p: string, body?: unknown): Promise<any>;
  put(p: string, body?: unknown): Promise<any>;
  del(p: string): Promise<any>;
  safeGet(p: string, fallback?: any): Promise<any>;
}

export class LCU implements LcuLike {
  creds: Credentials | null = null;
  customDir: string | null = null;

  get connected(): boolean { return !!this.creds; }

  async connect(): Promise<boolean> {
    this.creds = await findCredentials(this.customDir);
    if (!this.creds) return false;
    try {
      await this.get('/lol-summoner/v1/current-summoner');
      return true;
    } catch (e) {
      // Cliente a arrancar ou credenciais antigas
      if ((e as LcuError).status !== 404) this.creds = null;
      return !!this.creds;
    }
  }

  disconnect(): void { this.creds = null; }

  async request(method: string, pathname: string, body?: unknown): Promise<any> {
    if (!this.creds) throw new Error('LCU não ligado');
    try {
      return await rawRequest({ port: this.creds.port, method, pathname, body, auth: `riot:${this.creds.password}` });
    } catch (err) {
      const e = err as LcuError;
      if (e.code === 'ECONNREFUSED') this.creds = null;
      else if (e.status && e.status !== 404) {
        const detail = e.body && (e.body.message || e.body.errorCode) ? ` — ${e.body.message || e.body.errorCode}` : '';
        log.warn('lcu', `${method} ${pathname.replace(/[0-9a-f-]{30,}/gi, '<puuid>')} → HTTP ${e.status}${detail}`);
        if (detail) e.message += detail;
      } else if (!e.status) log.warn('lcu', `${method} ${pathname.split('?')[0]} → ${e.code || e.message}`);
      throw e;
    }
  }

  get(p: string) { return this.request('GET', p); }
  post(p: string, body?: unknown) { return this.request('POST', p, body); }
  put(p: string, body?: unknown) { return this.request('PUT', p, body); }
  del(p: string) { return this.request('DELETE', p); }

  async safeGet(p: string, fallback: any = null): Promise<any> {
    try { return await this.get(p); } catch { return fallback; }
  }
}

// API do jogo em curso (só existe enquanto a partida está aberta). Sem autenticação.
export async function liveClientData(): Promise<any> {
  try {
    return await rawRequest({ port: 2999, pathname: '/liveclientdata/allgamedata', timeout: 2500 });
  } catch {
    return null;
  }
}
