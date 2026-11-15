// Registo de erros e avisos (em memória + ficheiro), para diagnosticar problemas.
const fs = require('fs');
const path = require('path');

const MAX = 400;
const entries = [];
let file = null;

function setDir(dir) {
  if (!dir) return;
  file = path.join(dir, 'lol-scout.log');
  try {
    // mantém o ficheiro pequeno
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.renameSync(file, file + '.old');
  } catch { /* ignora */ }
}

function write(level, src, msg) {
  const e = { t: new Date().toISOString(), level, src, msg: String(msg && msg.stack ? msg.message : msg).slice(0, 1000) };
  // não repetir a mesma mensagem em loop
  const last = entries[entries.length - 1];
  if (last && last.msg === e.msg && last.src === e.src) { last.count = (last.count || 1) + 1; last.t = e.t; return; }
  entries.push(e);
  if (entries.length > MAX) entries.shift();
  if (file) {
    try { fs.appendFileSync(file, `${e.t} [${level}] ${src}: ${e.msg}\n`); } catch { /* sem disco */ }
  }
}

module.exports = {
  setDir,
  info: (src, msg) => write('info', src, msg),
  warn: (src, msg) => write('warn', src, msg),
  error: (src, msg) => write('error', src, msg),
  all: () => entries.slice(),
  text: () => entries.map((e) => `${e.t} [${e.level}] ${e.src}: ${e.msg}${e.count ? ` (x${e.count})` : ''}`).join('\n'),
  clear: () => { entries.length = 0; }
};
