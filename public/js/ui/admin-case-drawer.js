/**
 * admin-case-drawer.js - Panel lateral con el detalle completo de una alerta (admin)
 * Muestra foto, datos de contacto, ubicación y las acciones de moderación.
 */
import { renderIcon } from './icons.js';
import { caseBadge, typeLabel, when } from './admin-kit.js';
import { escapeHtml } from '../utils/format.js';
import { casesService } from '../services/cases.js';

/** Abre el panel. onAction(action, caso) se llama con 'approve' | 'reject' | 'resolve' | 'delete' */
export function openCaseDrawer(c, onAction) {
  closeCaseDrawer();
  const [lng, lat] = c.location?.coordinates || [];
  const actions = [];
  if (c.status === 'pending_review') {
    actions.push(['approve', 'Aprobar y publicar', 'button primary'], ['reject', 'Rechazar', 'button outline']);
  }
  // Si el filtro automático la rechazó por error, el equipo puede aprobarla
  if (c.status === 'rejected' && c.riskScore !== undefined) actions.push(['approve', 'Aprobar (falso positivo)', 'button primary']);
  if (c.status === 'active') actions.push(['resolve', 'Marcar como resuelta', 'button primary']);
  actions.push(['delete', 'Eliminar alerta', 'button ghost danger-text']);

  const el = document.createElement('div');
  el.className = 'drawer-scrim';
  el.innerHTML = `
    <aside class="drawer" role="dialog" aria-label="Detalle de la alerta">
      <header>
        <div><small>Folio ${escapeHtml(c.folio)}</small><h2>${escapeHtml(c.name)}</h2></div>
        <button type="button" class="drawer-close" aria-label="Cerrar">${renderIcon('close', 20)}</button>
      </header>
      <div class="drawer-body">
        ${(c.photo || c.thumb) ? `<img class="drawer-photo" src="${escapeHtml(c.photo || c.thumb)}" alt="${escapeHtml(c.name)}" />` : ''}
        <div class="drawer-row">${caseBadge(c.status)}<span class="badge muted">${typeLabel(c.type)}</span></div>
        ${c.status === 'rejected' ? `<p class="drawer-note">Motivo: ${escapeHtml(c.rejectionReason || '—')}</p>` : ''}
        ${c.riskScore !== undefined ? `
          <div class="risk-box ${c.riskScore >= 70 ? 'high' : c.riskScore >= 35 ? 'mid' : 'low'}">
            <b>Riesgo ${c.riskScore}/100</b><small>${c.riskSource === 'reglas+ia' ? 'Reglas + IA' : 'Reglas automáticas'}</small>
            ${c.riskReasons?.length ? `<ul>${c.riskReasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '<p>Sin señales de riesgo.</p>'}
          </div>` : ''}
        <dl>
          <dt>Datos</dt><dd>${escapeHtml(c.breedOrAge || '—')}</dd>
          <dt>Descripción</dt><dd>${escapeHtml(c.description || '—')}</dd>
          <dt>Última vez visto</dt><dd>${escapeHtml(c.lastSeenText || '—')}<small>${when(c.lastSeenAt)}</small></dd>
          <dt>Ubicación</dt><dd>${lat !== undefined ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : '—'}</dd>
          <dt>Reportado por</dt><dd>${escapeHtml(c.ownerName || '—')}<small>Relación: ${escapeHtml(c.relation || '—')}</small></dd>
          <dt>Teléfono de contacto</dt><dd>${escapeHtml(c.contactPhone || '—')}<small>Solo visible para el equipo</small></dd>
          <dt>Enviada</dt><dd>${when(c.createdAt)}</dd>
        </dl>
      </div>
      <footer>${actions.map(([a, label, cls]) => `<button type="button" class="${cls}" data-drawer-action="${a}">${label}</button>`).join('')}</footer>
    </aside>`;

  el.addEventListener('click', (e) => {
    if (e.target === el || e.target.closest('.drawer-close')) { closeCaseDrawer(); return; }
    const btn = e.target.closest('[data-drawer-action]');
    if (btn) { closeCaseDrawer(); onAction(btn.dataset.drawerAction, c); }
  });
  document.body.appendChild(el);

  // La lista trae solo la miniatura; la foto completa se descarga al abrir el detalle
  if (!c.photo) {
    casesService.get(c._id).then((full) => {
      const img = el.querySelector('.drawer-photo');
      if (full?.photo && img) img.src = full.photo;
    }).catch(() => {});
  }
}

export function closeCaseDrawer() {
  document.querySelector('.drawer-scrim')?.remove();
}
