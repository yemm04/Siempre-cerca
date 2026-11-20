/**
 * home.js - Pantalla principal de inicio con mapa y casos cercanos (06-inicio.png)
 * Muestra Leaflet con OpenStreetMap, pines con foto, filtros y panel de casos cercanos.
 */
import { escapeHtml } from '../utils/format.js';
import { renderIcon } from '../ui/icons.js';
import { renderNav, mountNavEvents } from '../ui/nav.js';
import { initials, formatDistance, formatRelativeTime } from '../utils/format.js';
import { getCurrentUserPosition } from '../utils/geo.js';
import { profileService } from '../services/profile.js';
import { casesService } from '../services/cases.js';
import { appState } from '../state.js';
import { showToast } from '../ui/toast.js';
import { initLeafletMap, addCasePinsToMap, setUserMarker, drawSearchPlan } from '../ui/map.js';

export function render() {
  const session = appState.getSession();
  const userName = session ? session.name : 'Usuario';
  const userInitials = initials(userName);

  return `
    <div class="screen home-screen desktop-home">
      <!-- Contenedor del Mapa Leaflet -->
      <div id="home-map" class="map"></div>

      <!-- Ficha del caso seleccionado en el mapa -->
      <aside class="pin-card" id="pin-card" hidden></aside>

      <!-- Cabecera flotante sobre el mapa -->
      <header class="map-header">
        <div class="top-row">
          <button type="button" class="avatar" id="btn-top-profile" aria-label="Mi perfil">
            ${escapeHtml(userInitials)}
          </button>
          <div>
            <small>Tu ubicación</small>
            <b id="loc-label">Lima, Perú</b>
          </div>
          <button type="button" class="round" id="btn-top-notif" aria-label="Notificaciones">
            ${renderIcon('bell')}
            <i></i>
          </button>
        </div>

        <div class="search">
          ${renderIcon('search')}
          <input type="text" id="search-input" placeholder="Buscar personas o mascotas..." />
        </div>

        <div class="pills" role="tablist">
          <button type="button" class="active" data-filter="all">Todos</button>
          <button type="button" data-filter="person">Personas</button>
          <button type="button" data-filter="pet">Mascotas</button>
        </div>
      </header>

      <!-- Botón de centrado en mi ubicación -->
      <button type="button" class="locate" id="btn-locate" aria-label="Centrar en mi ubicación">
        ${renderIcon('location')}
      </button>

      <!-- Hoja inferior de casos cerca de ti -->
      <section class="bottom-sheet" id="cases-sheet">
        <div class="handle"></div>
        <div class="sheet-title">
          <div>
            <h2>Casos cerca de ti</h2>
            <p id="cases-count-label">Cargando alertas cercanas...</p>
          </div>
          <button type="button" id="btn-see-all">Ver todos</button>
        </div>
        <div id="cases-list-container">
          <!-- Tarjetas renderizadas dinámicamente -->
        </div>
      </section>

      <!-- Botón flotante para crear alerta -->
      <button type="button" class="button alert" id="btn-floating-create">
        <span class="plus">+</span> Crear alerta
      </button>

      <!-- Barra de navegación inferior -->
      ${renderNav('home')}
    </div>
  `;
}

export function mount(root) {
  mountNavEvents(root);

  const searchInput = root.querySelector('#search-input');
  const filterPills = root.querySelectorAll('.pills button');
  const countLabel = root.querySelector('#cases-count-label');
  const listContainer = root.querySelector('#cases-list-container');
  const locateBtn = root.querySelector('#btn-locate');

  const pinCard = root.querySelector('#pin-card');
  const locLabel = root.querySelector('#loc-label');
  let radiusKm = 5;
  let selectedId = null;
  let lastCases = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let leafletMap = null;
  let pins = null;           // pines agrupados
  let userMarker = null;     // punto "tú estás aquí"
  let planLayer = null;      // círculo y mapa de calor del caso seleccionado
  const session = appState.getSession();

  let location = appState.getLocation();
  const kind = (c) => (c.type === 'pet' ? 'Mascota' : 'Persona');

  // Inicializar Leaflet centrado en Lima (Miraflores)
  try {
    leafletMap = initLeafletMap('home-map', {
      center: [location.lat, location.lng],
      zoom: 14,
    });
  } catch (e) {
    console.warn('Error inicializando mapa:', e);
  }

  const clearPlan = () => { planLayer?.destroy(); planLayer = null; };
  const closePinCard = () => {
    clearPlan();
    selectedId = null;
    if (pinCard) { pinCard.hidden = true; pinCard.innerHTML = ''; }
  };

  /** Ficha con toda la información del caso, al tocar un pin o una tarjeta */
  const openPinCard = (c) => {
    selectedId = c._id;
    const resolved = c.status === 'resolved';
    const dist = c.distanceKm != null ? formatDistance(c.distanceKm) : null;
    pinCard.innerHTML = `
      <button type="button" class="pin-close" id="pin-close" aria-label="Cerrar">${renderIcon('close', 16)}</button>
      <div class="pin-top">
        ${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" />` : `<span class="pin-initial">${escapeHtml((c.name || '?')[0].toUpperCase())}</span>`}
        <div>
          <span class="status ${resolved ? 'resolved' : ''}">${resolved ? 'RESUELTO' : 'ACTIVO'} · ${escapeHtml(formatRelativeTime(c.createdAt).toUpperCase())}</span>
          <h3>${escapeHtml(c.name)}${c.isDemo ? '<span class="demo-tag">CASO DE PRUEBA</span>' : ''}</h3>
          <p>${kind(c)}${c.breedOrAge ? ' · ' + escapeHtml(c.breedOrAge) : ''}</p>
        </div>
      </div>
      <dl class="pin-facts">
        <div><dt>Visto por última vez</dt><dd>${escapeHtml(c.lastSeenText || 'Lima')}</dd></div>
        <div><dt>Cuándo</dt><dd>${escapeHtml(formatRelativeTime(c.lastSeenAt || c.createdAt))}</dd></div>
        ${dist ? `<div><dt>Distancia</dt><dd>${escapeHtml(dist)} de ti</dd></div>` : ''}
        <div><dt>Búsqueda</dt><dd>${c.volunteersCount} ${c.volunteersCount === 1 ? 'voluntario' : 'voluntarios'} · Folio ${escapeHtml(c.folio)}</dd></div>
      </dl>
      ${c.description ? `<p class="pin-desc">${escapeHtml(c.description)}</p>` : ''}
      ${resolved ? '' : '<p class="plan-legend" id="pin-plan-note"><i></i><span>Calculando zona probable…</span></p>'}
      <div class="pin-actions">
        <button type="button" class="button primary" id="pin-open">Ver ficha completa</button>
        ${resolved ? '' : '<button type="button" class="button alert" id="pin-sight">Lo vi</button>'}
      </div>
      ${resolved || (session && c.ownerId === session._id) ? '' : '<div class="pin-actions"><button type="button" class="button outline" id="pin-join">Unirme a la búsqueda</button></div>'}`;
    pinCard.hidden = false;
    pinCard.querySelector('#pin-close').addEventListener('click', closePinCard);
    pinCard.querySelector('#pin-open').addEventListener('click', () => { window.location.hash = `#/caso/${c._id}`; });
    pinCard.querySelector('#pin-sight')?.addEventListener('click', () => { window.location.hash = `#/caso/${c._id}/avistamiento`; });
    pinCard.querySelector('#pin-join')?.addEventListener('click', () => { window.location.hash = `#/caso/${c._id}/busqueda`; });
    clearPlan();
    if (!resolved) {
      casesService.plan(c._id).then((plan) => {
        if (selectedId !== c._id || !leafletMap) return;   // el usuario ya eligió otro caso o cerró la ficha
        planLayer = drawSearchPlan(leafletMap, plan);
        const note = pinCard.querySelector('#pin-plan-note span');
        if (note) note.textContent = `Zona probable: radio de ${plan.radiusKm.toFixed(1)} km · más rojo = más probable`;
      }).catch(() => { const n = pinCard.querySelector('#pin-plan-note'); if (n) n.remove(); });
    }
    if (leafletMap && c.location?.coordinates) {
      const [lng, lat] = c.location.coordinates;
      leafletMap.panTo([lat, lng], { animate: true });
    }
  };

  const loadAndRenderCases = async () => {
    try {
      const cases = await casesService.listActive({
        lat: location.lat,
        lng: location.lng,
        radiusKm,
        type: currentFilter,
        q: searchQuery,
      });

      // Actualizar conteo
      lastCases = cases;
      const activeCount = cases.filter((c) => c.status === 'active').length;
      if (countLabel) {
        countLabel.textContent = `${activeCount} ${activeCount === 1 ? 'activo' : 'activos'} en un radio de ${radiusKm} km`;
      }

      // Renderizar tarjetas
      if (listContainer) {
        if (cases.length === 0) {
          listContainer.innerHTML = `
            <p style="text-align: center; color: var(--muted); font-size: 12px; padding: 24px 0;">
              No hay alertas en tu zona con estos filtros. Puedes ampliar el radio en tu perfil.
            </p>
          `;
        } else {
          listContainer.innerHTML = cases
            .map((c) => {
              const distText = c.distanceKm !== null ? `A ${formatDistance(c.distanceKm)} de ti` : 'Cerca de ti';
              const timeText = formatRelativeTime(c.createdAt).toUpperCase();
              return `
                <button type="button" class="case-card" data-case-id="${escapeHtml(c._id)}">
                  ${c.thumb ? `<img src="${escapeHtml(c.thumb)}" alt="${escapeHtml(c.name)}" />` : `<span class="pin-initial">${escapeHtml((c.name || '?')[0].toUpperCase())}</span>`}
                  <div>
                    <span class="status ${c.status === 'resolved' ? 'resolved' : ''}">
                      ${c.status === 'resolved' ? 'RESUELTO' : 'ACTIVO'} · ${timeText}
                    </span>
                    <h3>${escapeHtml(c.name)}</h3>
                    <p>${escapeHtml(c.breedOrAge || '')} · ${escapeHtml(c.lastSeenText || '')}</p>
                    <b>${renderIcon('location', 14)} ${distText}</b>
                  </div>
                  ${renderIcon('chevron')}
                </button>
              `;
            })
            .join('');

          // Click en tarjeta para ver detalle
          listContainer.querySelectorAll('[data-case-id]').forEach((btn) => {
            btn.addEventListener('click', () => {
              const found = lastCases.find((x) => x._id === btn.dataset.caseId);
              if (found) openPinCard(found);
            });
          });
        }
      }

      // Actualizar pines en Leaflet
      if (leafletMap) {
        pins?.destroy();
        pins = addCasePinsToMap(leafletMap, cases, openPinCard);
        if (location && !location.isDefault) userMarker = setUserMarker(leafletMap, userMarker, location.lat, location.lng);
        // Si había una ficha abierta, se mantiene (y se actualiza si el caso cambió)
        if (selectedId) {
          const still = cases.find((x) => x._id === selectedId);
          if (still) openPinCard(still); else closePinCard();
        }
      }
    } catch (err) {
      console.error('Error cargando casos:', err);
    }
  };

  // Buscador con debounce
  let debounceTimer = null;
  searchInput?.addEventListener('input', (e) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      searchQuery = e.target.value.trim();
      loadAndRenderCases();
    }, 250);
  });

  // Filtros de categoría
  filterPills.forEach((pill) => {
    pill.addEventListener('click', () => {
      filterPills.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter;
      loadAndRenderCases();
    });
  });

  // Usa la ubicación real del usuario (si dio permiso) y guarda su zona para avisarle de alertas cercanas
  const applyPosition = async (userInitiated) => {
    const pos = await getCurrentUserPosition();
    if (pos.isDefault) {
      if (userInitiated) showToast('No pudimos obtener tu ubicación. Revisa el permiso del navegador.', 'info');
      return;
    }
    appState.setLocation(pos);
    location = pos;
    if (locLabel) locLabel.textContent = 'Tu ubicación actual';
    profileService.saveLocation(pos.lat, pos.lng);
    if (leafletMap) { userMarker = setUserMarker(leafletMap, userMarker, pos.lat, pos.lng); leafletMap.setView([pos.lat, pos.lng], 15); }
    loadAndRenderCases();
  };
  locateBtn?.addEventListener('click', () => applyPosition(true));
  if (!location.isDefault && locLabel) locLabel.textContent = 'Tu ubicación actual';
  if (navigator.permissions?.query) {
    navigator.permissions.query({ name: 'geolocation' })
      .then((st) => { if (st.state === 'granted') applyPosition(false); })
      .catch(() => {});
  }

  // Mantiene el mapa al día sin recargar (cada 30 s, solo mientras esta pantalla está abierta)
  const refreshTimer = setInterval(() => {
    if (!root.isConnected) { clearInterval(refreshTimer); return; }
    loadAndRenderCases();
  }, 30000);

  // Accesos del header
  root.querySelector('#btn-top-profile')?.addEventListener('click', () => {
    window.location.hash = '#/perfil';
  });

  root.querySelector('#btn-top-notif')?.addEventListener('click', () => {
    window.location.hash = '#/notificaciones';
  });

  root.querySelector('#btn-floating-create')?.addEventListener('click', () => {
    window.location.hash = '#/crear';
  });

  // Cargar casos iniciales con el radio elegido en el perfil
  profileService.getSettings()
    .then((st) => { radiusKm = st.radiusKm || 5; })
    .catch(() => {})
    .finally(loadAndRenderCases);
}
