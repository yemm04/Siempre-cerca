/**
 * volunteers.js - Equipo de búsqueda de un caso
 * Mapa con 4 cuadrantes alrededor del último lugar visto; el voluntario elige su zona y la marca como revisada.
 */
import { renderIcon } from '../ui/icons.js';
import { renderNav, mountNavEvents } from '../ui/nav.js';
import { searchesService } from '../services/searches.js';
import { casesService } from '../services/cases.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml } from '../utils/format.js';
import { initLeafletMap, drawSearchPlan, setUserMarker } from '../ui/map.js';
import { appState } from '../state.js';

export function render() {
  return `<div class="screen volunteers-screen" id="volunteers-root"><p class="sub-intro empty" style="padding:40px">Cargando…</p></div>`;
}

// Cuadrantes respecto al punto de partida: A = norte, B = sur · 1 = oeste, 2 = este
const ZONE_NAMES = ['A1', 'A2', 'B1', 'B2'];

export function mount(root, params) {
  const container = root.querySelector('#volunteers-root');
  const caseId = params?.id;

  const loadData = async () => {
    try {
      const caseItem = await casesService.get(caseId);
      if (!caseItem) { container.innerHTML = '<p class="sub-intro empty" style="padding:40px">Alerta no encontrada.</p>'; return; }
      const [volunteerList, myParts, plan] = await Promise.all([
        searchesService.volunteers(caseId), searchesService.myParticipations(), casesService.plan(caseId).catch(() => null)]);
      const mine = myParts.find((p) => p.caseId === caseId);
      const myZone = mine?.zone || null;
      const inspected = Boolean(mine?.inspected);
      const open = caseItem.status === 'active';
      const [lng, lat] = caseItem.location.coordinates;

      container.innerHTML = `
        <header class="simple-header">
          <button type="button" class="back" id="btn-back">${renderIcon('arrow')} Volver</button>
          <span>Equipo de búsqueda</span>
          <span class="header-spacer"></span>
        </header>

        <div class="volunteer-map" id="volunteer-map" style="min-height:220px"></div>

        <section class="volunteer-panel">
          <div class="sheet-title">
            <div>
              <p class="eyebrow">Búsqueda de ${escapeHtml(caseItem.name)}</p>
              <h2>${volunteerList.length} ${volunteerList.length === 1 ? 'voluntario' : 'voluntarios'}</h2>
            </div>
            ${open ? '<span class="live"><i></i> EN VIVO</span>' : ''}
          </div>

          ${open ? `
          <div class="assignment">
            <div class="icon-box green">${renderIcon('location')}</div>
            <div>
              <small>${myZone ? 'Tu zona asignada' : 'Elige tu zona'}</small>
              <b>${myZone ? `Cuadrante ${escapeHtml(myZone)}` : 'Toca un cuadrante'} · ${escapeHtml(caseItem.lastSeenText || 'Lima')}</b>
            </div>
          </div>
          ${plan && !plan.closed ? `<p class="plan-legend"><i></i><span>Radio probable: ${plan.radiusKm.toFixed(1)} km (${escapeHtml(plan.categoryLabel.toLowerCase())}). El cuadrante con ★ es el que más necesita ayuda ahora.</span></p>` : ''}
          <div class="zone-picker" style="display:flex;gap:8px;margin:10px 0">
            ${ZONE_NAMES.map((z) => { const info = plan?.zones?.find((x) => x.zone === z); return `<button type="button" class="button ${z === myZone ? 'primary' : 'outline'}" data-zone="${z}" style="flex:1;min-height:42px">${z}${info?.suggested ? ' ★' : ''}${info?.inspected ? ' ✓' : ''}</button>`; }).join('')}
          </div>` : '<p class="sub-intro">Esta alerta ya no está activa.</p>'}

          <h3>Personas buscando</h3>
          <div class="volunteer-list">
            ${volunteerList.length ? volunteerList.map((v) => `
              <div>
                <span class="vol-avatar ${escapeHtml(v.color || 'sage')}">${escapeHtml(v.initials)}</span>
                <div><b>${escapeHtml(v.name)}</b><small>${escapeHtml(v.area)}</small></div>
              </div>`).join('') : '<p class="sub-intro empty">Aún nadie se unió. ¡Sé la primera persona!</p>'}
          </div>

          ${open && myZone ? `
          <button type="button" class="button ${inspected ? 'soft' : 'primary'}" id="btn-inspect-zone">
            ${renderIcon('check')}<span>${inspected ? 'Zona marcada como revisada' : 'Marcar mi zona como revisada'}</span>
          </button>` : ''}
        </section>

        ${renderNav('community')}
      `;
      mountNavEvents(container);

      // Mapa: radio probable, mapa de calor, los 4 cuadrantes y tu ubicación
      try {
        const map = initLeafletMap('volunteer-map', { center: [lat, lng], zoom: 16 });
        if (map && window.L) {
          if (plan && !plan.closed) {
            const layer = drawSearchPlan(map, plan, { quadrants: true, myZone });
            if (layer.bounds) map.fitBounds(layer.bounds.pad(0.1), { maxZoom: 17 });
          } else {
            window.L.circleMarker([lat, lng], { radius: 7, color: '#fff', weight: 2, fillColor: '#C8553D', fillOpacity: 1 }).addTo(map);
          }
          const me = appState.getLocation();
          if (me && !me.isDefault) setUserMarker(map, null, me.lat, me.lng);
        }
      } catch (e) { console.warn('Mapa no disponible:', e); }

      container.querySelector('#btn-back')?.addEventListener('click', () => { window.location.hash = `#/caso/${caseId}`; });

      container.querySelectorAll('[data-zone]').forEach((btn) => btn.addEventListener('click', async () => {
        try {
          await searchesService.join(caseId, btn.dataset.zone);
          showToast(`Te uniste al cuadrante ${btn.dataset.zone}`, 'success');
          loadData();
        } catch (err) { showToast(err.message || 'No se pudo unir a la búsqueda', 'error'); }
      }));

      container.querySelector('#btn-inspect-zone')?.addEventListener('click', async () => {
        try {
          const res = await searchesService.markZoneInspected(caseId);
          showToast(res.inspected ? `¡Zona ${myZone} marcada como revisada!` : 'Zona desmarcada', 'success');
          loadData();
        } catch (err) { showToast(err.message || 'Error al actualizar la zona', 'error'); }
      });
    } catch (err) {
      container.innerHTML = `<p class="sub-intro empty" style="padding:40px">${escapeHtml(err.message)}</p>`;
    }
  };

  loadData();
}
