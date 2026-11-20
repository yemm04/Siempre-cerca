/**
 * community.js - Pantalla de Comunidad
 * Cifras del mes, búsquedas activas cercanas y reencuentros recientes: todo viene de la base de datos.
 */
import { renderIcon } from '../ui/icons.js';
import { renderNav, mountNavEvents } from '../ui/nav.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml, formatDistance, formatRelativeTime } from '../utils/format.js';
import { casesService } from '../services/cases.js';
import { appState } from '../state.js';

const kindLabel = (t) => (t === 'pet' ? 'MASCOTA' : 'PERSONA');

function thumbOrInitial(item, cls = 'chip-initial ochre') {
  return item.thumb
    ? `<img src="${escapeHtml(item.thumb)}" alt="${escapeHtml(item.name)}" />`
    : `<span class="${cls}">${escapeHtml((item.name || '?')[0].toUpperCase())}</span>`;
}

export function render() {
  return `
    <div class="screen community-screen">
      <div class="community-scroll">
        <header class="community-head">
          <p class="eyebrow">Lima, Perú</p>
          <h1>Tu <em>comunidad</em></h1>
          <p class="subtitle">Vecinos que se mueven juntos cuando alguien lo necesita.</p>
        </header>

        <section class="impact-card" id="impact-card">
          <span class="impact-label">Este mes</span>
          <div class="impact-main"><b>—</b><span>casos resueltos<br>gracias a la comunidad</span></div>
          <div class="impact-row">
            <div><b>—</b><span>voluntarios activos</span></div>
            <div><b>—</b><span>a la primera pista</span></div>
          </div>
        </section>

        <div class="section-head">
          <h2>Búsquedas activas cerca de ti</h2>
          <span class="live"><i></i> EN VIVO</span>
        </div>
        <div id="active-list"><p class="muted-note">Cargando…</p></div>

        <div class="section-head"><h2>Reencuentros recientes</h2></div>
        <div class="reunion-strip" id="reunion-list"><p class="muted-note">Cargando…</p></div>

        <div class="section-head"><h2>Cómo puedes ayudar</h2></div>
        <div class="profile-group">
          <div class="profile-row static">
            <div class="icon-box coral">${renderIcon('share', 19)}</div>
            <div><b>Comparte las alertas</b><span>Cada difusión multiplica las posibilidades</span></div>
          </div>
          <div class="profile-row static">
            <div class="icon-box green">${renderIcon('location', 19)}</div>
            <div><b>Revisa tu zona</b><span>Camina tu cuadra y marca lo inspeccionado</span></div>
          </div>
          <div class="profile-row static">
            <div class="icon-box ochre">${renderIcon('camera', 19)}</div>
            <div><b>Reporta con foto</b><span>Un avistamiento con imagen se confirma más rápido</span></div>
          </div>
        </div>

        <button type="button" class="button soft" id="btn-invite-neighbors">
          ${renderIcon('share')} Invitar a mis vecinos
        </button>
      </div>

      ${renderNav('community')}
    </div>
  `;
}

export function mount(root) {
  mountNavEvents(root);
  const loc = appState.getLocation();

  casesService.community({ lat: loc.lat, lng: loc.lng }).then((data) => {
    const m = data.month;
    root.querySelector('#impact-card').innerHTML = `
      <span class="impact-label">Este mes</span>
      <div class="impact-main"><b>${m.resolved}</b><span>casos resueltos<br>gracias a la comunidad</span></div>
      <div class="impact-row">
        <div><b>${m.volunteers}</b><span>voluntarios activos</span></div>
        <div><b>${m.firstClueMinutes === null ? '—' : `${m.firstClueMinutes} min`}</b><span>a la primera pista</span></div>
      </div>`;

    const activeEl = root.querySelector('#active-list');
    activeEl.innerHTML = data.active.length
      ? data.active.map((c) => {
          const checked = c.searchQuadrants?.checked || 0;
          const total = c.searchQuadrants?.total || 4;
          const dist = c.distanceKm != null ? ` · A ${escapeHtml(formatDistance(c.distanceKm))}` : '';
          return `
        <article class="search-card">
          <div class="search-top">
            ${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" />` : thumbOrInitial(c)}
            <div>
              <span class="status">${kindLabel(c.type)}${dist}</span>
              <h3>${escapeHtml(c.name)}</h3>
              <p>${escapeHtml(c.breedOrAge || '')}${c.breedOrAge && c.lastSeenText ? ' · ' : ''}${escapeHtml(c.lastSeenText || '')}</p>
            </div>
          </div>
          <div class="progress-line">
            <div><i style="width: ${Math.round((checked / total) * 100)}%;"></i></div>
            <small>${checked} de ${total} cuadrantes revisados · <b>${c.volunteersCount} ${c.volunteersCount === 1 ? 'persona buscando' : 'personas buscando'}</b></small>
          </div>
          <div class="card-actions">
            <button type="button" class="button outline" data-see="${escapeHtml(c._id)}">Ver caso</button>
            <button type="button" class="button primary" data-join="${escapeHtml(c._id)}">Unirme a la búsqueda</button>
          </div>
        </article>`;
        }).join('')
      : `<p class="muted-note">No hay búsquedas activas ahora mismo. ¡Buenas noticias!</p>`;
    activeEl.querySelectorAll('[data-see]').forEach((b) => b.addEventListener('click', () => { window.location.hash = `#/caso/${b.dataset.see}`; }));
    activeEl.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => { window.location.hash = `#/caso/${b.dataset.join}/busqueda`; }));

    const reunionEl = root.querySelector('#reunion-list');
    reunionEl.innerHTML = data.reunions.length
      ? data.reunions.map((r) => `
        <button type="button" class="reunion-chip" data-reunion="${escapeHtml(r._id)}">
          ${thumbOrInitial(r)}
          <b>${escapeHtml(r.name)}</b>
          <small>${escapeHtml(formatRelativeTime(r.resolvedAt))} · ${r.helpers} ${r.helpers === 1 ? 'persona' : 'personas'}</small>
          <em>${renderIcon('check', 11)} En casa</em>
        </button>`).join('')
      : `<p class="muted-note">Aquí aparecerán los reencuentros de la comunidad.</p>`;
    reunionEl.querySelectorAll('[data-reunion]').forEach((b) => b.addEventListener('click', () => { window.location.hash = `#/resuelto/${b.dataset.reunion}`; }));
  }).catch((err) => {
    root.querySelector('#active-list').innerHTML = `<p class="muted-note">${escapeHtml(err.message)}</p>`;
    root.querySelector('#reunion-list').innerHTML = '';
  });

  root.querySelector('#btn-invite-neighbors')?.addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({
        title: 'Siempre Cerca - Red Comunitaria de Búsqueda',
        text: 'Únete a nuestra red comunitaria para encontrar personas y mascotas extraviadas en Lima.',
        url: window.location.origin,
      }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(window.location.origin);
      showToast('Enlace de invitación copiado', 'info');
    }
  });
}
