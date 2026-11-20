/**
 * sighting.js - Registrar y enviar avistamiento (13-avistamiento y 14-avistamiento-enviado)
 * Captura ubicación GPS, nota, foto opcional con canvas y confirmación inmediata.
 */
import { renderIcon } from '../ui/icons.js';
import { resizeImage } from '../utils/image.js';
import { sightingsService } from '../services/sightings.js';
import { casesService } from '../services/cases.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml } from '../utils/format.js';
import { getCurrentUserPosition } from '../utils/geo.js';
import { initLeafletMap } from '../ui/map.js';

export function render(params) {
  return `
    <div class="screen sighting-screen" id="sighting-root">
      <div style="text-align: center; padding: 50px 0; color: #fff;">Cargando...</div>
    </div>
  `;
}

export function mount(root, params) {
  const container = root.querySelector('#sighting-root');
  const caseId = params?.id;

  let sent = false;
  let photoData = null;
  let stillThere = 'yes';
  let note = '';
  let address = '';
  let coords = null; // { lat, lng }
  let usingGps = false;
  let leafletMap = null;

  const renderView = async () => {
    container.innerHTML = `
      <div class="sighting-map" id="sighting-map">
        <div class="you-pin"><span></span></div>
      </div>

      <section class="modal-sheet">
        <div class="handle"></div>

        <div class="modal-head">
          <div>
            <p class="eyebrow">Reporte rápido</p>
            <h1>${sent ? '¡Reporte enviado!' : 'Registrar avistamiento'}</h1>
          </div>
          <button type="button" id="btn-close-modal" aria-label="Cerrar">
            ${renderIcon('close')}
          </button>
        </div>

        ${
          sent
            ? `
          <div class="sent-state">
            <div>${renderIcon('check', 36)}</div>
            <p>Gracias por ayudar. Avisamos al responsable y a los voluntarios cercanos.</p>
            <button type="button" class="button primary" id="btn-back-case">Volver al caso</button>
          </div>
        `
            : `
          <div class="gps-tag">
            ${renderIcon('location')}
            <div style="flex:1">
              <b>${usingGps ? 'Ubicación detectada (GPS)' : 'Mueve el mapa al lugar exacto'}</b>
              <input type="text" id="inp-address" maxlength="160" value="${escapeHtml(address)}" placeholder="Referencia: calle, parque, esquina…" style="width:100%;margin-top:4px" />
            </div>
          </div>

          <input type="file" id="file-sighting-photo" accept="image/*" style="display: none;" />
          <button type="button" class="photo-attach" id="btn-attach-photo">
            <div>${renderIcon('camera', 27)}</div>
            <span>
              <b>${photoData ? '✓ Foto adjuntada' : 'Agregar foto'}</b>
              <small>${photoData ? 'Toca para cambiar la imagen' : 'Ayuda a confirmar el avistamiento'}</small>
            </span>
            ${renderIcon('chevron')}
          </button>

          <label>¿Dónde lo viste y cómo se veía?
            <textarea id="inp-sighting-note" placeholder="Ej. Lo vi corriendo hacia la esquina, llevaba su collar azul...">${escapeHtml(note)}</textarea>
          </label>

          <div class="urgency">
            <span>¿Sigue en el lugar?</span>
            <button type="button" class="${stillThere === 'yes' ? 'active' : ''}" id="btn-still-yes">Sí, aún está</button>
            <button type="button" class="${stillThere === 'unsure' ? 'active' : ''}" id="btn-still-unsure">No estoy seguro</button>
          </div>

          <button type="button" class="button alert" id="btn-send-sighting">
            Enviar reporte <span>→</span>
          </button>
        `
        }
      </section>
    `;

    container.querySelector('#btn-close-modal')?.addEventListener('click', () => {
      window.location.hash = `#/caso/${caseId}`;
    });

    if (sent) {
      container.querySelector('#btn-back-case')?.addEventListener('click', () => {
        window.location.hash = `#/caso/${caseId}`;
      });
      return;
    }

    const noteInp = container.querySelector('#inp-sighting-note');
    noteInp?.addEventListener('input', (e) => (note = e.target.value));

    const fileInput = container.querySelector('#file-sighting-photo');
    container.querySelector('#btn-attach-photo')?.addEventListener('click', () => {
      fileInput?.click();
    });

    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          photoData = await resizeImage(file, 800, 0.6);
          renderView();
          showToast('Foto agregada al reporte', 'success');
        } catch (err) {
          showToast('Error procesando imagen', 'error');
        }
      }
    });

    container.querySelector('#btn-still-yes')?.addEventListener('click', () => {
      stillThere = 'yes';
      renderView();
    });

    container.querySelector('#btn-still-unsure')?.addEventListener('click', () => {
      stillThere = 'unsure';
      renderView();
    });

    container.querySelector('#inp-address')?.addEventListener('input', (e) => { address = e.target.value; });

    // Mapa para marcar el punto exacto del avistamiento
    try {
      leafletMap = initLeafletMap('sighting-map', { center: [coords.lat, coords.lng], zoom: 16 });
      leafletMap?.on('move', () => { const c = leafletMap.getCenter(); coords = { lat: c.lat, lng: c.lng }; });
    } catch (err) { console.warn('Mapa no disponible:', err); }

    const sendBtn = container.querySelector('#btn-send-sighting');
    sendBtn?.addEventListener('click', async () => {
      if (!note.trim()) {
        showToast('Por favor describe lo que viste', 'error');
        return;
      }
      if (address.trim().length < 3) {
        showToast('Escribe una referencia del lugar (calle, parque…)', 'error');
        return;
      }
      try {
        sendBtn.disabled = true;
        await sightingsService.create(caseId, {
          lat: coords.lat,
          lng: coords.lng,
          where: address.trim(),
          note: note.trim(),
          photo: photoData,
          stillThere,
        });
        sent = true;
        renderView();
        showToast('¡Avistamiento registrado!', 'success');
      } catch (err) {
        sendBtn.disabled = false;
        showToast(err.message || 'Error al enviar reporte', 'error');
      }
    });
  };

  // Punto de partida: GPS del usuario si lo permite; si no, el último lugar donde se vio el caso
  (async () => {
    const [caseItem, pos] = await Promise.all([casesService.get(caseId).catch(() => null), getCurrentUserPosition()]);
    if (!pos.isDefault) { coords = { lat: pos.lat, lng: pos.lng }; usingGps = true; }
    else if (caseItem?.location?.coordinates) { coords = { lat: caseItem.location.coordinates[1], lng: caseItem.location.coordinates[0] }; }
    else { coords = { lat: pos.lat, lng: pos.lng }; }
    renderView();
  })();
}
