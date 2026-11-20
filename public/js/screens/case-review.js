/**
 * case-review.js - Pantalla de alerta en revisión (11-alerta-en-revision.png)
 * Muestra el estado del reporte (publicado, en revisión o no aprobado).
 */
import { escapeHtml } from '../utils/format.js';
import { renderIcon } from '../ui/icons.js';
import { casesService } from '../services/cases.js';

export function render(params) {
  return `
    <div class="screen padded review-screen" id="review-root">
      <div style="text-align: center; padding: 40px 0; color: var(--muted);">Cargando reporte...</div>
    </div>
  `;
}

export function mount(root, params) {
  const container = root.querySelector('#review-root');
  const caseId = params?.id;

  const loadCase = async () => {
    try {
      const caseItem = await casesService.get(caseId);
      if (!caseItem) {
        container.innerHTML = `
          <div class="padded">
            <button type="button" class="back" id="btn-nf-back">
              ${renderIcon('arrow')} Volver
            </button>
            <p style="margin-top: 40px; color: var(--muted); text-align: center;">Reporte no encontrado</p>
          </div>
        `;
        container.querySelector('#btn-nf-back')?.addEventListener('click', () => { window.location.hash = '#/inicio'; });
        return;
      }

      const isApproved = caseItem.status === 'active';
      const isRejected = caseItem.status === 'rejected';

      container.innerHTML = `
        <div class="review-back">
          <button type="button" class="back" id="btn-back">
            ${renderIcon('arrow')} Inicio
          </button>
        </div>

        <div class="review-art">
          <span class="orbit o1"></span>
          <span class="orbit o2"></span>
          <div>${renderIcon(isApproved ? 'check' : isRejected ? 'close' : 'clock', 35)}</div>
          <i>✓</i><b>✓</b>
        </div>

        <p class="eyebrow">${isApproved ? 'Alerta publicada' : isRejected ? 'Alerta no aprobada' : 'Alerta enviada'}</p>
        <h1>Tu caso está<br><em>${isApproved ? 'activo' : isRejected ? 'no aprobado' : 'en revisión'}</em></h1>
        <p class="subtitle">
          ${
            isApproved
              ? 'Tu alerta ya es visible para toda la comunidad en el mapa.'
              : isRejected
              ? `Motivo: ${escapeHtml(caseItem.rejectionReason || 'No cumple con las normas de la comunidad.')}`
              : 'Por seguridad, nuestro equipo revisará la información antes de compartirla con la comunidad.'
          }
        </p>

        <div class="review-card">
          <div class="review-head">
            <span>Estado del reporte</span>
            <b style="${isApproved ? 'color: var(--green); background: rgba(163,177,138,.2);' : ''}">
              <i></i> ${isApproved ? 'ACTIVA' : isRejected ? 'NO APROBADA' : 'EN REVISIÓN'}
            </b>
          </div>

          <div class="case-mini">
            <img src="${escapeHtml(caseItem.thumb || caseItem.photo || '')}" alt="${escapeHtml(caseItem.name)}" />
            <div>
              <b>${escapeHtml(caseItem.name)}</b>
              <span>${caseItem.type === 'pet' ? 'Mascota perdida' : 'Persona desaparecida'} · Lima</span>
              <small>Folio #${escapeHtml(caseItem.folio)}</small>
            </div>
          </div>

          <div class="timeline">
            <span class="done">
              <i>${renderIcon('check', 13)}</i>
              <b>Reporte recibido</b>
              <small>Completado</small>
            </span>
            <span class="${isApproved ? 'done' : ''}">
              <i>${renderIcon(isApproved ? 'check' : 'clock', 13)}</i>
              <b>Validación del equipo</b>
              <small>${isApproved ? 'Aprobado' : 'En revisión'}</small>
            </span>
            <span class="${isApproved ? 'done' : ''}">
              <i>${renderIcon('check', 13)}</i>
              <b>Publicación de la alerta</b>
              <small>${isApproved ? 'Visible en el mapa' : 'Pendiente'}</small>
            </span>
          </div>
        </div>

        <div class="info-note">
          ${renderIcon('bell')}
          <span>
            <b>${isApproved ? 'Alerta difundida' : isRejected ? 'Puedes volver a intentarlo' : 'Te avisaremos cuando esté listo'}</b>
            ${
              isApproved
                ? 'Los vecinos cercanos pueden enviar avistamientos y unirse a la búsqueda.'
                : isRejected
                ? 'Corrige la información y crea una nueva alerta con el botón +.'
                : 'Recibirás una notificación apenas el caso sea publicado en el mapa.'
            }
          </span>
        </div>

        <button type="button" class="button primary" id="btn-go-home">
          ${isApproved ? 'Ver en el mapa de Inicio' : 'Volver al inicio'}
        </button>
      `;

      container.querySelector('#btn-back')?.addEventListener('click', () => {
        window.location.hash = '#/inicio';
      });

      container.querySelector('#btn-go-home')?.addEventListener('click', () => {
        window.location.hash = '#/inicio';
      });

    } catch (err) {
      console.error('Error cargando revisión de caso:', err);
    }
  };

  loadCase();
}
