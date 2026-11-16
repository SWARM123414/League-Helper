// Janela principal: arranca o motor e depois a interface.
import './ui/style.css';
import { startBackend } from './app/backend.ts';
import { initUI } from './ui/app.ts';

startBackend()
  .then(() => initUI())
  .catch((e) => {
    document.body.insertAdjacentHTML('beforeend', `<pre class="fatal">LoL Scout: ${String(e && e.stack ? e.stack : e)}</pre>`);
  });
