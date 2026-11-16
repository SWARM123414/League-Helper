// Ponte entre o motor (TypeScript puro) e o sistema.
// Na app é implementada com comandos Tauri (Rust); nos testes com o Node.

export interface LocalRequest {
  port: number;
  method?: string;
  path: string;
  /** "utilizador:password" para Basic auth */
  auth?: string;
  body?: unknown;
  timeoutMs?: number;
}

export interface LocalResponse {
  status: number;
  body: any;
}

export interface LeagueProcess {
  /** linha de comandos do LeagueClientUx.exe ('' se não estiver aberto) */
  cmdline: string;
  /** pasta do executável (onde fica o lockfile) */
  exeDir: string | null;
}

export interface Platform {
  readData(name: string): Promise<string | null>;
  writeData(name: string, text: string): Promise<void>;
  appendData(name: string, text: string): Promise<void>;
  rotateData(name: string, maxBytes: number): Promise<void>;
  /** HTTPS para 127.0.0.1 (aceita o certificado da Riot). Falhas de ligação: Error('ECONNREFUSED') */
  localRequest(req: LocalRequest): Promise<LocalResponse>;
  leagueProcess(): Promise<LeagueProcess>;
  /** conteúdo do primeiro lockfile que existir */
  readLockfile(paths: string[]): Promise<string | null>;
  sleep(ms: number): Promise<void>;
}

let current: Platform | null = null;

export function setPlatform(p: Platform): void {
  current = p;
}

export function platform(): Platform {
  if (!current) throw new Error('platform não configurada');
  return current;
}

export const sleep = (ms: number): Promise<void> => (current ? current.sleep(ms) : new Promise((r) => setTimeout(r, ms)));
