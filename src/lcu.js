// Ligação ao cliente do League of Legends (LCU API) e à Live Client Data API.
// O cliente expõe uma API local em https://127.0.0.1:<porta> com um certificado
// próprio da Riot. A porta e a password vêm do "lockfile" ou da linha de comandos
// do processo LeagueClientUx.exe.

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execFile } = require('child_process');
const log = require('./log');

// Só aceitamos o certificado auto-assinado para ligações a 127.0.0.1.
const localAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

const LOCKFILE_CANDIDATES = [
  'C:\\Riot Games\\League of Legends\\lockfile',
  'D:\\Riot Games\\League of Legends\\lockfile',
  'E:\\Riot Games\\League of Legends\\lockfile',
  'C:\\Program Files\\Riot Games\\League of Legends\\lockfile',
  'D:\\Games\\Riot Games\\League of Legends\\lockfile',
  '/Applications/League of Legends.app/Contents/LoL/lockfile'
];

function parseLockfile(text) {
  // formato: LeagueClient:<pid>:<porta>:<password>:https
  const parts = text.trim().split(':');
  if (parts.length < 5) return null;
  return { pid: Number(parts[1]), port: Number(parts[2]), password: parts[3], protocol: parts[4] };
}

function parseCommandLine(cmd) {
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

function readCommandLineWindows() {
  return new Promise((resolve) => {
    const ps = "Get-CimInstance Win32_Process -Filter \"name='LeagueClientUx.exe'\" | Select-Object -ExpandProperty CommandLine";
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 8000 },
      (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

function readCommandLineMac() {
  return new Promise((resolve) => {
    execFile('ps', ['-A', '-o', 'args'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve('');
      const line = String(stdout).split('\n').find((l) => l.includes('LeagueClientUx'));
      resolve(line || '');
    });
  });
}

async function findCredentials(customDir) {
  // 1) Processo em execução (mais fiável, funciona com qualquer pasta de instalação)
  const cmd = process.platform === 'win32' ? await readCommandLineWindows()
    : process.platform === 'darwin' ? await readCommandLineMac() : '';
  const fromCmd = cmd ? parseCommandLine(cmd) : null;
  if (fromCmd) return fromCmd;

  // 2) Lockfile na pasta indicada nas definições ou nas pastas habituais
  const candidates = [];
  if (customDir) candidates.push(path.join(customDir, 'lockfile'));
  candidates.push(...LOCKFILE_CANDIDATES);
  for (const file of candidates) {
    try {
      if (fs.existsSync(file)) {
        const creds = parseLockfile(fs.readFileSync(file, 'utf8'));
        if (creds) return creds;
      }
    } catch { /* lockfile bloqueado ou inexistente */ }
  }
  return null;
}

function rawRequest({ port, method = 'GET', pathname, auth, body, timeout = 6000 }) {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : null;
    const headers = { Accept: 'application/json' };
    if (auth) headers.Authorization = 'Basic ' + Buffer.from(auth).toString('base64');
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    const req = https.request({ host: '127.0.0.1', port, method, path: pathname, headers, agent: localAgent, timeout }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let json = null;
        try { json = chunks ? JSON.parse(chunks) : null; } catch { json = chunks; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else {
          const e = new Error(`HTTP ${res.statusCode} em ${pathname}`);
          e.status = res.statusCode; e.body = json;
          reject(e);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

class LCU {
  constructor() {
    this.creds = null;
    this.customDir = null;
  }

  get connected() { return !!this.creds; }

  async connect() {
    this.creds = await findCredentials(this.customDir);
    if (!this.creds) return false;
    try {
      await this.get('/lol-summoner/v1/current-summoner');
      return true;
    } catch (e) {
      // Cliente a arrancar ou credenciais antigas
      if (e.status !== 404) this.creds = null;
      return !!this.creds;
    }
  }

  disconnect() { this.creds = null; }

  async request(method, pathname, body) {
    if (!this.creds) throw new Error('LCU não ligado');
    try {
      return await rawRequest({ port: this.creds.port, method, pathname, body, auth: `riot:${this.creds.password}` });
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') this.creds = null;
      else if (e.status && e.status !== 404) {
        const detail = e.body && (e.body.message || e.body.errorCode) ? ` — ${e.body.message || e.body.errorCode}` : '';
        log.warn('lcu', `${method} ${pathname.replace(/[0-9a-f-]{30,}/gi, '<puuid>')} → HTTP ${e.status}${detail}`);
        if (detail) e.message += detail;
      } else if (!e.status) log.warn('lcu', `${method} ${pathname.split('?')[0]} → ${e.code || e.message}`);
      throw e;
    }
  }

  get(p) { return this.request('GET', p); }
  post(p, body) { return this.request('POST', p, body); }
  put(p, body) { return this.request('PUT', p, body); }
  del(p) { return this.request('DELETE', p); }

  async safeGet(p, fallback = null) {
    try { return await this.get(p); } catch { return fallback; }
  }
}

// API do jogo em curso (só existe enquanto a partida está aberta). Sem autenticação.
async function liveClientData() {
  try {
    return await rawRequest({ port: 2999, pathname: '/liveclientdata/allgamedata', timeout: 2500 });
  } catch {
    return null;
  }
}

module.exports = { LCU, liveClientData, parseLockfile, parseCommandLine };
