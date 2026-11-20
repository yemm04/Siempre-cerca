/**
 * my-searches.js - Búsquedas en las que participo
 * Cuadrantes asignados, divididos en búsquedas en curso y finalizadas (datos reales).
 */
import { renderIcon } from '../ui/icons.js';
import { searchesService } from '../services/searches.js';
import { escapeHtml, formatDate } from '../utils/format.js';

export function render() {
  return `
    <div class="screen sub-screen">
      <header class="simple-header">
        <button type="button" class="back" id="btn-back">
          ${renderIcon('arrow')} Perfil
        </button>
        <span>Mis búsquedas</span>
        <span class="header-spacer"></span>
      </header>

      <div class="sub-scroll" id="searches-container">
        <p class="sub-intro">Búsquedas de otras personas a las que te uniste como voluntario.</p>
        <p class="sub-intro empty">Cargando…</p>
      </div>
    </div>
  `;
}

const thumb = (c) => (c.thumb
  ? `<img class="thumb" src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" />`
  : `<span class="thumb chip-initial coral">${escapeHtml((c.name || '?')[0].toUpperCase())}</span>`);

export function mount(root) {
  const container = root.querySelector('#searches-container');
  root.querySelector('#btn-back')?.addEventListener('click', () => { window.location.hash = '#/perfil'; });

  searchesService.myParticipations().then((list) => {
    const active = list.filter((p) => p.case.status === 'active');
    const done = list.filter((p) => p.case.status === 'resolved');
    const card = (p, finished) => `
      <button type="button" class="mini-card" data-go="${escapeHtml(finished ? `#/resuelto/${p.caseId}` : `#/caso/${p.caseId}/busqueda`)}">
        ${thumb(p.case)}
        <div>
          <em class="status-chip ${finished ? 'green' : 'coral'}"><i></i>${finished ? (p.case.type === 'pet' ? 'Encontrada' : 'Encontrado') : 'En curso'}</em>
          <b>Búsqueda de ${escapeHtml(p.case.name)}</b>
          <span>Tu zona: Cuadrante ${escapeHtml(p.zone)} · ${escapeHtml(p.case.lastSeenText || 'Lima')}</span>
          <small>${p.case.volunteers} ${p.case.volunteers === 1 ? 'voluntario' : 'voluntarios'}${p.inspected ? ' · zona revisada ✓' : ''}${finished && p.case.resolvedAt ? ' · ' + escapeHtml(formatDate(p.case.resolvedAt)) : ''}</small>
        </div>
        ${renderIcon('chevron', 17)}
      </button>`;
    container.innerHTML = `
      <p class="sub-intro">Búsquedas de otras personas a las que te uniste como voluntario.</p>
      ${list.length === 0 ? '<p class="sub-intro empty">Aún no te has unido a ninguna búsqueda. Entra a una alerta y toca “Unirme”.</p>' : ''}
      ${active.length ? `<p class="group-title">En curso</p>${active.map((p) => card(p, false)).join('')}` : ''}
      ${done.length ? `<p class="group-title">Finalizadas</p>${done.map((p) => card(p, true)).join('')}` : ''}`;
    container.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => { window.location.hash = b.dataset.go; }));
  }).catch((err) => { container.innerHTML = `<p class="sub-intro empty">${escapeHtml(err.message)}</p>`; });
}
