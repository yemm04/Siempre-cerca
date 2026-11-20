/**
 * settings.js - Panel de administración · Ajustes
 * Historial de moderación y reglas de aprobación automática.
 */
import { renderIcon } from '../../ui/icons.js';
import { renderAdminShell, mountAdminShell } from '../../ui/admin-layout.js';
import { when, empty } from '../../ui/admin-kit.js';
import { adminService } from '../../services/admin.js';
import { appState } from '../../state.js';
import { escapeHtml } from '../../utils/format.js';

const LABELS = {
  case_approved: 'Aprobó alerta', case_rejected: 'Rechazó alerta', case_resolved: 'Resolvió alerta', case_deleted: 'Eliminó alerta',
  user_banned: 'Suspendió usuario', user_unbanned: 'Reactivó usuario', sighting_status: 'Actualizó avistamiento',
};

const CRITERIA = [
  'Las alertas se publican solas: no hace falta aprobarlas una por una.',
  'Máximo 3 alertas por día y 1 por minuto por usuario; no se permiten duplicados.',
  'Si el texto trae enlaces, publicidad o palabras sospechosas, queda “en revisión” para ti.',
  'Si 3 vecinos distintos denuncian una alerta, se oculta hasta que la revises.',
  'Puedes rechazar, eliminar o suspender cuentas; el usuario suspendido pierde su sesión al instante.',
];

export function render() {
  return renderAdminShell({
    active: 'settings',
    title: 'Ajustes <em>y registro</em>',
    subtitle: 'Historial del equipo y reglas de aprobación automática.',
    body: `
      <section class="admin-grid">
        <article class="card span-2">
          <header class="card-head"><h2>Historial de moderación</h2><small>Últimas acciones</small></header>
          <div id="audit-list"></div>
        </article>

        <div class="stack">
          <article class="card">
            <header class="card-head"><h2>Reglas automáticas</h2></header>
            <ul class="checklist">${CRITERIA.map((c) => `<li>${renderIcon('check', 14)}<span>${c}</span></li>`).join('')}</ul>
          </article>

          <article class="card">
            <header class="card-head"><h2>Sistema</h2></header>
            <dl class="sys">
              <dt>Base de datos</dt><dd>PostgreSQL</dd>
              <dt>Tu rol</dt><dd>${escapeHtml(appState.getSession()?.role || '')}</dd>
            </dl>
          </article>
        </div>
      </section>`,
  });
}

export function mount(root) {
  mountAdminShell(root);
  const list = root.querySelector('#audit-list');

  adminService.listAudit(40).then((items) => {
    list.innerHTML = items.length ? `
      <table class="admin-table">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Detalle</th></tr></thead>
        <tbody>${items.map((a) => `
          <tr><td>${when(a.createdAt)}</td><td>${escapeHtml(a.adminName)}</td><td>${LABELS[a.action] || a.action}</td>
          <td class="clip">${escapeHtml(a.targetLabel || '')}</td><td class="clip">${escapeHtml(a.detail || '—')}</td></tr>`).join('')}</tbody>
      </table>` : empty('Todavía no hay acciones registradas. Aprueba o rechaza una alerta para verlas aquí.');
  }).catch((err) => { list.innerHTML = empty(err.message); });

}
