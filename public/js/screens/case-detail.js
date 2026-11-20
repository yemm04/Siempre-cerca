/**
 * case-detail.js - Detalle completo del caso (12-detalle-caso.png)
 * Mapa con zonas de búsqueda, fotos, distancia, equipo de voluntarios y acciones.
 */
import { escapeHtml } from '../utils/format.js';
import { renderIcon } from '../ui/icons.js';
import { formatDistance, formatRelativeTime } from '../utils/format.js';
import { haversineDistanceKm } from '../utils/geo.js';
import { casesService } from '../services/cases.js';
import { appState } from '../state.js';
import { initLeafletMap, drawSearchPlan } from '../ui/map.js';
import { showToast } from '../ui/toast.js';
import { showConfirmModal } from '../ui/modal.js';

export function render(params) {
  return `
    <div class="screen case-detail desktop-case" id="case-detail-root">
      <div style="text-align: center; padding: 50px 0; color: var(--muted);">Cargando caso...</div>
    </div>
  `;
}

export function mount(root, params) {
  const container = root.querySelector('#case-detail-root');
  const caseId = params?.id;
  const session = appState.getSession();
  const userLoc = appState.getLocation();

  const loadCase = async () => {
    try {
      const caseItem = await casesService.get(caseId);
      if (!caseItem) {
        container.innerHTML = `
          <div class="padded">
            <button type="button" class="back" id="btn-nf-back">
              ${renderIcon('arrow')} Volver
            </button>
            <p style="margin-top: 40px; text-align: center; color: var(--muted);">Caso no encontrado</p>
          </div>
        `;
        container.querySelector('#btn-nf-back')?.addEventListener('click', () => { window.location.hash = '#/inicio'; });
        return;
      }

      const isOwner = session && session._id === caseItem.ownerId;
      let distKm = null;
      if (caseItem.location?.coordinates && userLoc) {
        const [cLng, cLat] = caseItem.location.coordinates;
        distKm = haversineDistanceKm(userLoc.lat, userLoc.lng, cLat, cLng);
      }

      const volunteers = Number(caseItem.volunteersCount || 0);
      const distText = distKm === null ? '—' : formatDistance(distKm);
      const timeAgo = formatRelativeTime(caseItem.createdAt).toUpperCase();

      container.innerHTML = `
        <!-- Mapa del lugar donde se vio por última vez -->
        <div id="detail-map" class="map detailed"></div>

        <!-- Cabecera flotante -->
        <header class="overlay-header">
          <button type="button" id="btn-detail-back" aria-label="Volver">
            ${renderIcon('arrow')}
          </button>
          <span>Detalle del caso</span>
          <button type="button" id="btn-detail-share" aria-label="Compartir">
            ${renderIcon('share')}
          </button>
        </header>

        <!-- Hoja de información -->
        <section class="detail-sheet">
          <div class="handle"></div>

          <div class="hero-photo">
            <img src="${escapeHtml(caseItem.photo || caseItem.thumb)}" alt="${escapeHtml(caseItem.name)}" />
            <span>1 / 1</span>
          </div>

          <div class="case-heading">
            <div>
              <span class="status ${caseItem.status === 'resolved' ? 'resolved' : ''}">
                ${{ resolved: 'RESUELTO', archived: 'ARCHIVADO', pending_review: 'EN REVISIÓN', rejected: 'NO PUBLICADA' }[caseItem.status] || 'ACTIVO'} · HACE ${timeAgo}
              </span>
              <h1>${escapeHtml(caseItem.name)}${caseItem.isDemo ? '<span class="demo-tag">CASO DE PRUEBA</span>' : ''}</h1>
              <p>${escapeHtml(caseItem.breedOrAge || '')}</p>
            </div>
            <div class="distance">
              ${renderIcon('location')}
              <b>${distText}</b>
              <span>de ti</span>
            </div>
          </div>

          <div class="detail-facts">
            <span>
              <small>Visto por última vez</small>
              <b>${escapeHtml(caseItem.lastSeenText || 'Lima')}</b>
            </span>
            <span>
              <small>Cuándo</small>
              <b>${formatRelativeTime(caseItem.lastSeenAt || caseItem.createdAt)}</b>
            </span>
          </div>

          <p class="description">${escapeHtml(caseItem.description || '')}</p>

          ${isOwner && caseItem.status === 'archived' ? `
            <div class="insight-box warn">
              <b>Esta alerta se archivó por inactividad</b>
              <p>Ya no aparece en el mapa. Si todavía lo buscas, reactívala.</p>
              <button type="button" class="button primary" id="btn-renew">Reactivar alerta</button>
            </div>` : ''}
          ${caseItem.status === 'active' ? `
            <div class="insight-box" id="box-summary" hidden></div>
            <div class="insight-box" id="box-tips"><b>Consejos de búsqueda</b><p class="muted">Preparando consejos…</p></div>
            <p class="plan-legend"><i></i><span id="plan-note">Calculando zona probable…</span></p>` : ''}

          <button type="button" class="volunteer-banner" id="btn-banner-volunteers">
            <div class="volunteer-faces">
              ${renderIcon('group')}
            </div>
            <div>
              <b>${volunteers === 0 ? 'Aún nadie se unió a la búsqueda' : volunteers === 1 ? '1 persona buscando' : `${volunteers} personas buscando`}</b>
              <small>${caseItem.status === 'resolved' ? 'Esta alerta ya fue resuelta' : 'Únete a la búsqueda en tu zona'}</small>
            </div>
            ${renderIcon('chevron')}
          </button>

          ${
            isOwner && caseItem.status === 'active'
              ? `
            <div style="margin-top: 14px;">
              <button type="button" class="button primary" id="btn-mark-resolved">
                ✓ ${caseItem.type === 'pet' ? 'Ya encontré a mi mascota' : 'Ya encontramos a la persona'}
              </button>
              <p class="hint" style="margin-top:6px">Solo tú puedes cerrar esta alerta. Avisaremos a quienes ayudaron.</p>
            </div>
          `
              : !isOwner && caseItem.status === 'active'
              ? `<div style="margin-top: 14px;"><button type="button" class="button ghost" id="btn-report">⚑ Reportar esta alerta como falsa o inapropiada</button></div>`
              : ''
          }
        </section>

        <!-- Barra inferior de acciones -->
        ${caseItem.status === 'active' ? `<footer class="action-bar">
          <button type="button" class="button alert" id="btn-action-sighting">
            ${renderIcon('location')} Enviar avistamiento
          </button>
          <button type="button" class="button primary" id="btn-action-join">
            ${renderIcon('group')} Unirme
          </button>
          <button type="button" class="share-button" id="btn-action-share">
            ${renderIcon('share')}
            <span>Compartir</span>
          </button>
        </footer>` : ''}
      `;

      // Inicializar Leaflet si es posible
      try {
        if (caseItem.location?.coordinates) {
          const [lng, lat] = caseItem.location.coordinates;
          const map = initLeafletMap('detail-map', { center: [lat, lng], zoom: 15 });
          if (caseItem.status === 'active') {
            casesService.plan(caseId).then((plan) => {
              if (!map) return;
              const layer = drawSearchPlan(map, plan);
              if (layer.bounds) map.fitBounds(layer.bounds.pad(0.15), { maxZoom: 16 });
              const n = container.querySelector('#plan-note');
              if (n) n.textContent = `Zona probable: radio de ${plan.radiusKm.toFixed(1)} km (${plan.categoryLabel.toLowerCase()}) · más rojo = más probable`;
            }).catch(() => { container.querySelector('.plan-legend')?.remove(); });
          }
        }
      } catch (e) {
        console.warn('Error inicializando mapa de detalle:', e);
      }

      // Consejos y resumen de pistas (con IA si el servidor la tiene activada; si no, con reglas)
      const chip = (src) => (src === 'ia' ? ' <span class="ia-chip">IA</span>' : '');
      const lines = (t) => escapeHtml(t).split('\n').map((x) => `<p>${x}</p>`).join('');
      if (caseItem.status === 'active') {
        casesService.tips(caseId).then((t) => {
          const box = container.querySelector('#box-tips');
          if (box) box.innerHTML = `<b>Consejos de búsqueda${chip(t.source)}</b>${lines(t.text)}`;
        }).catch(() => container.querySelector('#box-tips')?.remove());
        casesService.summary(caseId).then((t) => {
          const box = container.querySelector('#box-summary');
          if (!box) return;
          box.hidden = false;
          box.innerHTML = `<b>Resumen de pistas${chip(t.source)}</b><p>${escapeHtml(t.text)}</p>`;
        }).catch(() => { /* quien no participa no ve el resumen */ });
      }
      container.querySelector('#btn-renew')?.addEventListener('click', async () => {
        try { await casesService.renew(caseId); showToast('Alerta reactivada', 'success'); loadCase(); }
        catch (err) { showToast(err.message || 'No se pudo reactivar', 'error'); }
      });

      // Eventos
      container.querySelector('#btn-detail-back')?.addEventListener('click', () => {
        window.location.hash = '#/inicio';
      });

      const handleShare = () => {
        if (navigator.share) {
          navigator.share({
            title: `Alerta: ${caseItem.name} en Siempre Cerca`,
            text: `Ayúdanos a encontrar a ${caseItem.name}. Visto por última vez en ${caseItem.lastSeenText}.`,
            url: window.location.href,
          }).catch(() => {});
        } else {
          navigator.clipboard?.writeText(window.location.href);
          showToast('Enlace copiado al portapapeles', 'info');
        }
      };

      container.querySelector('#btn-detail-share')?.addEventListener('click', handleShare);
      container.querySelector('#btn-action-share')?.addEventListener('click', handleShare);

      container.querySelector('#btn-banner-volunteers')?.addEventListener('click', () => {
        window.location.hash = `#/caso/${caseId}/busqueda`;
      });

      container.querySelector('#btn-action-join')?.addEventListener('click', () => {
        window.location.hash = `#/caso/${caseId}/busqueda`;
      });

      container.querySelector('#btn-action-sighting')?.addEventListener('click', () => {
        window.location.hash = `#/caso/${caseId}/avistamiento`;
      });

      container.querySelector('#btn-mark-resolved')?.addEventListener('click', () => {
        showConfirmModal({
          title: '¿Ya fue encontrado?',
          message: `Se cerrará la alerta de ${caseItem.name} y se avisará a los vecinos que ayudaron.`,
          confirmText: 'Sí, ya apareció',
          onConfirm: async () => {
            try {
              await casesService.markResolved(caseId);
              showToast('¡Qué gran noticia! Alerta cerrada.', 'success');
              window.location.hash = `#/resuelto/${caseId}`;
            } catch (err) {
              showToast(err.message || 'Error al cerrar la alerta', 'error');
            }
          },
        });
      });

      container.querySelector('#btn-report')?.addEventListener('click', () => {
        showConfirmModal({
          title: '¿Reportar esta alerta?',
          message: 'Úsalo solo si crees que es falsa, repetida o inapropiada. El equipo la revisará.',
          confirmText: 'Sí, reportar',
          onConfirm: async () => {
            try {
              await casesService.report(caseId, 'Reportada por la comunidad');
              showToast('Gracias, el equipo la revisará.', 'success');
            } catch (err) {
              showToast(err.message || 'No se pudo enviar el reporte', 'error');
            }
          },
        });
      });
    } catch (err) {
      console.error('Error cargando detalle de caso:', err);
    }
  };

  loadCase();
}
