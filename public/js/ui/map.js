/**
 * map.js - Componente de mapa interactivo con Leaflet y OpenStreetMap
 * Centrado en Lima y restringido a Perú. Incluye: tu ubicación, pines por tipo/urgencia, agrupación de pines
 * cercanos, círculo de alcance y mapa de calor de zonas probables.
 */
import { CONFIG } from '../config.js';
import { escapeHtml } from '../utils/format.js';

const FRESH_MS = 6 * 3600 * 1000; // una alerta de menos de 6 h se considera reciente

export function createCasePinHtml(photoUrl, { resolved = false, type = 'pet', fresh = false, demo = false } = {}) {
  const cls = ['case-pin', resolved ? 'resolved' : '', `kind-${type === 'person' ? 'person' : 'pet'}`, fresh && !resolved ? 'fresh' : '', demo ? 'demo' : ''].filter(Boolean).join(' ');
  const inner = photoUrl
    ? `<img src="${escapeHtml(photoUrl)}" alt="" />`
    : `<b class="pin-fallback">!</b>`;
  return `<div class="${cls}">${inner}<span></span>${demo ? '<em class="pin-demo">PRUEBA</em>' : ''}</div>`;
}

/** Inicializa un mapa Leaflet en un elemento contenedor */
export function initLeafletMap(containerId, options = {}) {
  const container = document.getElementById(containerId);
  if (!container) return null;
  if (typeof window.L === 'undefined') {
    console.warn('Leaflet no está cargado. Se utilizará mapa esquemático de respaldo.');
    return null;
  }
  const center = options.center || [CONFIG.LIMA_CENTER.lat, CONFIG.LIMA_CENTER.lng];
  const zoom = options.zoom || CONFIG.DEFAULT_ZOOM;
  const map = window.L.map(containerId, {
    center, zoom, minZoom: CONFIG.MIN_ZOOM, maxZoom: CONFIG.MAX_ZOOM, maxBounds: CONFIG.PERU_BOUNDS,
    zoomControl: false, attributionControl: true,
  });
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  return map;
}

const pinIcon = (c) => window.L.divIcon({
  html: createCasePinHtml(c.thumb || c.photo, {
    resolved: c.status === 'resolved', type: c.type, demo: c.isDemo,
    fresh: Date.now() - new Date(c.createdAt || c.lastSeenAt || 0).getTime() < FRESH_MS,
  }),
  className: 'custom-leaflet-pin', iconSize: [48, 48], iconAnchor: [24, 48],
});

/**
 * Pines de casos con agrupación: los pines muy juntos se funden en una burbuja con el número de casos;
 * al tocarla el mapa se acerca. Devuelve { destroy() }.
 */
export function addCasePinsToMap(map, cases, onPinClick) {
  if (!map || typeof window.L === 'undefined') return { destroy() {} };
  const L = window.L;
  const layer = L.layerGroup().addTo(map);
  const items = cases.filter((c) => c.location?.coordinates).map((c) => ({ c, lat: c.location.coordinates[1], lng: c.location.coordinates[0] }));

  const draw = () => {
    layer.clearLayers();
    const zoom = map.getZoom();
    const size = 64; // px: dos pines más cerca que esto se agrupan
    const groups = new Map();
    for (const it of items) {
      const pt = map.project([it.lat, it.lng], zoom);
      const key = zoom >= 17 ? it.c._id : `${Math.floor(pt.x / size)}:${Math.floor(pt.y / size)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    for (const g of groups.values()) {
      if (g.length === 1) {
        const { c, lat, lng } = g[0];
        const m = L.marker([lat, lng], { icon: pinIcon(c) }).addTo(layer);
        if (typeof onPinClick === 'function') m.on('click', () => onPinClick(c));
      } else {
        const lat = g.reduce((a, x) => a + x.lat, 0) / g.length, lng = g.reduce((a, x) => a + x.lng, 0) / g.length;
        const m = L.marker([lat, lng], {
          icon: L.divIcon({ html: `<div class="pin-cluster"><b>${g.length}</b></div>`, className: 'custom-leaflet-pin', iconSize: [46, 46], iconAnchor: [23, 23] }),
        }).addTo(layer);
        m.on('click', () => map.fitBounds(L.latLngBounds(g.map((x) => [x.lat, x.lng])).pad(0.4), { maxZoom: 17 }));
      }
    }
  };
  draw();
  map.on('zoomend', draw);
  return { destroy() { map.off('zoomend', draw); layer.remove(); } };
}

/** Punto "Tú estás aquí" (azul y pulsante), como en los juegos de mapa */
export function setUserMarker(map, state, lat, lng) {
  if (!map || typeof window.L === 'undefined') return state;
  if (state?.marker) { state.marker.setLatLng([lat, lng]); return state; }
  const marker = window.L.marker([lat, lng], {
    icon: window.L.divIcon({ html: '<div class="user-dot"><i></i><b></b></div>', className: 'custom-leaflet-pin', iconSize: [26, 26], iconAnchor: [13, 13] }),
    interactive: false, zIndexOffset: 1000,
  }).addTo(map);
  return { marker };
}

const heatColor = (s) => (s > 0.75 ? '#c8553d' : s > 0.5 ? '#e08a3c' : s > 0.3 ? '#e9c46a' : '#9ccf9a');

/**
 * Dibuja el plan de búsqueda: círculo del radio probable, mapa de calor por celdas y,
 * si se pide, los 4 cuadrantes (A1, A2, B1, B2) con el tuyo resaltado. Devuelve { destroy() }.
 */
export function drawSearchPlan(map, plan, { quadrants = false, myZone = null } = {}) {
  if (!map || typeof window.L === 'undefined' || !plan || plan.closed) return { destroy() {} };
  const L = window.L;
  const g = L.layerGroup().addTo(map);
  for (const c of plan.cells || []) {
    L.rectangle(c.bounds, { stroke: !!c.top, color: '#8a2f1d', weight: c.top ? 2 : 0, fillColor: heatColor(c.score), fillOpacity: 0.12 + c.score * 0.38, interactive: false }).addTo(g);
  }
  const center = [plan.center.lat, plan.center.lng];
  L.circle(center, { radius: plan.radiusKm * 1000, color: '#c8553d', weight: 2, dashArray: '6 6', fillOpacity: 0.03, interactive: false }).addTo(g);
  if (plan.center.source === 'sighting') {
    L.circleMarker([plan.origin.lat, plan.origin.lng], { radius: 5, color: '#fff', weight: 2, fillColor: '#6b7280', fillOpacity: 1, interactive: false }).addTo(g);
  }
  L.circleMarker(center, { radius: 7, color: '#fff', weight: 2, fillColor: '#c8553d', fillOpacity: 1, interactive: false }).addTo(g);
  if (quadrants) {
    const dLat = plan.radiusKm / 111.32, dLng = plan.radiusKm / (111.32 * Math.cos((center[0] * Math.PI) / 180));
    const box = { A1: [[center[0], center[1] - dLng], [center[0] + dLat, center[1]]], A2: [[center[0], center[1]], [center[0] + dLat, center[1] + dLng]],
      B1: [[center[0] - dLat, center[1] - dLng], [center[0], center[1]]], B2: [[center[0] - dLat, center[1]], [center[0], center[1] + dLng]] };
    for (const z of plan.zones) {
      const mine = z.zone === myZone;
      L.rectangle(box[z.zone], { color: mine ? '#2D6A4F' : '#6b7280', weight: mine ? 3 : 1, dashArray: mine ? null : '2 6', fill: false })
        .bindTooltip(`${z.zone}${z.suggested ? ' ★' : ''}${z.inspected ? ' ✓' : ''}`, { permanent: true, direction: 'center', className: 'zone-label' }).addTo(g);
    }
  }
  return { destroy() { g.remove(); }, bounds: L.circle(center, { radius: plan.radiusKm * 1000 }).getBounds() };
}

/** Inicializa un selector de ubicación interactivo para la creación de alertas */
export function initLocationPickerMap(containerId, initialCoords, onChange) {
  const map = initLeafletMap(containerId, { center: [initialCoords.lat, initialCoords.lng], zoom: 15 });
  if (!map) return null;
  map.on('move', () => {
    const center = map.getCenter();
    if (typeof onChange === 'function') onChange({ lat: center.lat, lng: center.lng });
  });
  return map;
}
