/**
 * help.js - Centro de ayuda (32-centro-de-ayuda.png / 33-centro-de-ayuda-abierta.png)
 * Búsqueda, categorías, preguntas desplegables y contactos de emergencia en Perú.
 */
import { CONFIG } from '../config.js';
import { renderIcon } from '../ui/icons.js';
import { escapeHtml } from '../utils/format.js';
import { showToast } from '../ui/toast.js';
import { FAQS, FAQ_CATEGORIES } from '../data/faqs.js';
import { casesService } from '../services/cases.js';

const row = (icon, tone, title, sub, id) => `
  <button type="button" class="profile-row" ${id ? `id="${id}"` : ''}>
    <div class="icon-box ${tone}">${renderIcon(icon, 19)}</div>
    <div><b>${title}</b><span>${sub}</span></div>
    ${renderIcon('chevron', 17)}
  </button>`;

export function render() {
  return `
    <div class="screen sub-screen">
      <header class="simple-header">
        <button type="button" class="back" id="btn-back">${renderIcon('arrow')} Perfil</button>
        <span>Centro de ayuda</span>
        <span class="header-spacer"></span>
      </header>
      <div class="sub-scroll">
        <section class="assistant" aria-label="Asistente de ayuda">
          <p class="group-title" style="margin-top:0">Pregúntale al asistente</p>
          <div class="assistant-log" id="assistant-log" aria-live="polite">
            <div class="msg bot">Hola, soy el asistente de Siempre Cerca. Pregúntame cómo crear una alerta, unirte a una búsqueda o cuidar tu cuenta.</div>
          </div>
          <form class="assistant-form" id="assistant-form">
            <input type="text" id="assistant-input" maxlength="400" placeholder="Escribe tu pregunta…" autocomplete="off" />
            <button type="submit" class="button primary" id="assistant-send">Enviar</button>
          </form>
          <p class="hint">No reemplaza a la Policía. En una emergencia llama al 105.</p>
        </section>
        <div class="search help-search">
          ${renderIcon('search')}
          <input type="text" id="help-q" placeholder="¿En qué podemos ayudarte?" />
        </div>
        <div class="pills help-pills" id="help-cats">
          ${FAQ_CATEGORIES.map((c, i) => `<button type="button" class="${i === 0 ? 'active' : ''}" data-cat="${c}">${c}</button>`).join('')}
        </div>
        <div class="faq-list" id="faq-list"></div>

        <p class="group-title">¿Necesitas más ayuda?</p>
        <div class="profile-group">
          ${row('mail', 'green', 'Escribir a soporte', `${CONFIG.SUPPORT_EMAIL} · respondemos en 24 h`, 'help-mail')}
          ${row('flag', 'coral', 'Reportar un aviso falso o mal uso', 'Ayúdanos a mantener segura la comunidad', 'help-report')}
          ${row('phone', 'coral', 'Emergencias: 105', 'Si hay riesgo inmediato, llama primero a la Policía (105). Bomberos 116 · SAMU 106', 'help-sos')}
        </div>
      </div>
    </div>`;
}

export function mount(root) {
  const list = root.querySelector('#faq-list');
  const input = root.querySelector('#help-q');
  let cat = 'Todo';
  let open = null;

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const items = FAQS.map((f, i) => ({ ...f, i }))
      .filter((f) => (cat === 'Todo' || f.cat === cat) && (!q || (f.q + f.a).toLowerCase().includes(q)));
    if (!items.length) {
      list.innerHTML = '<p class="sub-intro empty">No encontramos resultados. Prueba con otras palabras o escríbenos.</p>';
      return;
    }
    list.innerHTML = items.map((f) => `
      <article class="faq ${open === f.i ? 'open' : ''}">
        <button type="button" data-i="${f.i}" aria-expanded="${open === f.i}">
          <span>${escapeHtml(f.q)}</span>${renderIcon('chevron', 17)}
        </button>
        <p>${escapeHtml(f.a)}</p>
      </article>`).join('');
  };

  list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const i = Number(btn.dataset.i);
    open = open === i ? null : i;
    draw();
  });

  input.addEventListener('input', () => { open = null; draw(); });

  root.querySelector('#help-cats').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    cat = btn.dataset.cat;
    open = null;
    root.querySelectorAll('#help-cats button').forEach((b) => b.classList.toggle('active', b === btn));
    draw();
  });

  root.querySelector('#btn-back').addEventListener('click', () => { window.location.hash = '#/perfil'; });
  root.querySelector('#help-mail').addEventListener('click', () => { window.location.href = `mailto:${CONFIG.SUPPORT_EMAIL}`; });
  root.querySelector('#help-report').addEventListener('click', () => { window.location.href = `mailto:${CONFIG.SUPPORT_EMAIL}?subject=${encodeURIComponent('Reporte de un problema')}`; });
  root.querySelector('#help-sos').addEventListener('click', () => showToast('Policía 105 · Bomberos 116 · SAMU 106', 'info'));

  // ---- Asistente de ayuda (con IA si el servidor la tiene activada; si no, busca en las preguntas frecuentes) ----
  const log = root.querySelector('#assistant-log');
  const form = root.querySelector('#assistant-form');
  const box = root.querySelector('#assistant-input');
  const send = root.querySelector('#assistant-send');
  const addMsg = (who, html) => {
    const d = document.createElement('div');
    d.className = `msg ${who}`;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  const ask = async (text) => {
    addMsg('me', escapeHtml(text));
    const wait = addMsg('bot', '<span class="muted">Escribiendo…</span>');
    send.disabled = true;
    try {
      const r = await casesService.ask(text);
      wait.innerHTML = `${escapeHtml(r.answer)}${r.source === 'ia' ? ' <span class="ia-chip">IA</span>' : ''}`;
      if (r.suggestions?.length) {
        const s = document.createElement('div');
        s.className = 'assistant-sugg';
        s.innerHTML = r.suggestions.map((q) => `<button type="button" data-q="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
        wait.appendChild(s);
      }
    } catch (err) {
      wait.textContent = err.message || 'No pude responder ahora. Intenta de nuevo.';
    } finally { send.disabled = false; log.scrollTop = log.scrollHeight; }
  };
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = box.value.trim();
    if (text.length < 2) return;
    box.value = '';
    ask(text);
  });
  log.addEventListener('click', (e) => { const b = e.target.closest('button[data-q]'); if (b) ask(b.dataset.q); });

  draw();
}
