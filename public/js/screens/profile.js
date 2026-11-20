/**
 * profile.js - Pantalla de Perfil de usuario (20-perfil, 21-perfil-abajo y 34-cerrar-sesion)
 * Gestión de actividad, radio de alerta, accesos de seguridad y modal de cierre de sesión.
 */
import { renderIcon } from '../ui/icons.js';
import { renderNav, mountNavEvents } from '../ui/nav.js';
import { initials } from '../utils/format.js';
import { maskPhone, maskEmail } from '../utils/mask.js';
import { profileService } from '../services/profile.js';
import { authService } from '../services/auth.js';
import { appState } from '../state.js';
import { showToast } from '../ui/toast.js';
import { escapeHtml } from '../utils/format.js';
import { casesService } from '../services/cases.js';
import { sightingsService } from '../services/sightings.js';
import { searchesService } from '../services/searches.js';

export function render() {
  const session = appState.getSession();
  const name = session ? session.name : 'Usuario';
  const username = session ? session.username : 'usuario';
  const phone = session?.phone ? maskPhone(session.phone) : '';
  const email = session?.email ? maskEmail(session.email) : '';
  const userInitials = initials(name);

  return `
    <div class="screen profile-screen">
      <div class="profile-scroll">
        <header class="profile-hero">
          <span class="avatar big">${escapeHtml(userInitials)}</span>
          <h1>${escapeHtml(name)}</h1>
          <p>@${escapeHtml(username)}</p>
          <span class="verified-badge">
            ${renderIcon('shield', 13)} Número verificado · ${escapeHtml(phone)}
          </span>
        </header>

        <div class="stats profile-stats">
          <div><b id="stat-alerts">–</b><span>Alertas creadas</span></div>
          <div><b id="stat-sightings">–</b><span>Avistamientos</span></div>
          <div><b id="stat-searches">–</b><span>Búsquedas</span></div>
        </div>

        <!-- Mi actividad -->
        <p class="group-title">Mi actividad</p>
        <div class="profile-group">
          <button type="button" class="profile-row" id="row-my-alerts">
            <div class="icon-box ochre">${renderIcon('clock', 19)}</div>
            <div>
              <b>Mis alertas</b>
              <span id="sub-alerts">Cargando…</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-my-searches">
            <div class="icon-box green">${renderIcon('group', 19)}</div>
            <div>
              <b>Búsquedas en las que participo</b>
              <span id="sub-searches">Cargando…</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-my-sightings">
            <div class="icon-box coral">${renderIcon('location', 19)}</div>
            <div>
              <b>Mis avistamientos</b>
              <span id="sub-sightings">Cargando…</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>
        </div>

        <!-- Alertas cerca de ti -->
        <p class="group-title">Alertas cerca de ti</p>
        <div class="profile-group">
          <div class="profile-row static">
            <div class="icon-box green">${renderIcon('location', 19)}</div>
            <div>
              <b>Radio de alertas</b>
              <span>Casos que verás en tu mapa</span>
            </div>
          </div>
          <div class="radius-pick" role="radiogroup" aria-label="Radio de alertas" id="radius-container">
            <button type="button" data-r="1">1 km</button>
            <button type="button" data-r="3">3 km</button>
            <button type="button" data-r="5">5 km</button>
            <button type="button" data-r="10">10 km</button>
            <button type="button" data-r="20">20 km</button>
          </div>

          <div class="profile-row static">
            <div class="icon-box coral">${renderIcon('bell', 19)}</div>
            <div>
              <b>Notificaciones</b>
              <span>Avisos por correo y en la app</span>
            </div>
            <span role="switch" aria-checked="true" class="toggle" id="toggle-notif"><span></span></span>
          </div>

          <div class="profile-row static">
            <div class="icon-box green">${renderIcon('location', 19)}</div>
            <div>
              <b>Usar mi ubicación</b>
              <span>Para mostrarte casos y avisarte de alertas cerca</span>
            </div>
            <span role="switch" aria-checked="true" class="toggle" id="toggle-loc"><span></span></span>
          </div>
        </div>

        <!-- Cuenta y seguridad -->
        <p class="group-title">Cuenta y seguridad</p>
        <div class="profile-group">
          <button type="button" class="profile-row" id="row-edit-profile">
            <div class="icon-box green">${renderIcon('user', 19)}</div>
            <div>
              <b>Editar perfil</b>
              <span>Nombre, usuario y foto</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-phone">
            <div class="icon-box green">${renderIcon('phone', 19)}</div>
            <div>
              <b>Teléfono</b>
              <span>${escapeHtml(phone)}</span>
            </div>
            <em class="row-badge">Verificado</em>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-email">
            <div class="icon-box ochre">${renderIcon('mail', 19)}</div>
            <div>
              <b>Correo</b>
              <span>${escapeHtml(email)}</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-password">
            <div class="icon-box green">${renderIcon('lock', 19)}</div>
            <div>
              <b>Cambiar contraseña</b>
              <span>Seguridad de acceso</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>
        </div>

        <!-- Ayuda -->
        <p class="group-title">Ayuda</p>
        <div class="profile-group">
          <button type="button" class="profile-row" id="row-help">
            <div class="icon-box green">${renderIcon('help', 19)}</div>
            <div>
              <b>Centro de ayuda</b>
              <span>Preguntas frecuentes y soporte</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>

          <button type="button" class="profile-row" id="row-emergency">
            <div class="icon-box coral">${renderIcon('phone', 19)}</div>
            <div>
              <b>Emergencias</b>
              <span>Llama a la Policía (105) si hay riesgo inmediato</span>
            </div>
            ${renderIcon('chevron', 17)}
          </button>
        </div>

        <button type="button" class="logout" id="btn-open-logout">
          ${renderIcon('logout', 18)} Cerrar sesión
        </button>

        <p class="app-version">Siempre Cerca · versión 1.0</p>
      </div>

      <!-- Scrim de confirmación de cierre de sesión (34-cerrar-sesion.png) -->
      <div class="confirm-scrim" id="logout-scrim" style="display: none;">
        <div class="confirm-sheet" id="logout-sheet">
          <div class="handle"></div>
          <h2>¿Cerrar sesión?</h2>
          <p>Podrás volver a entrar con tu usuario y contraseña cuando quieras.</p>
          <button type="button" class="button alert" id="btn-confirm-logout">Sí, cerrar sesión</button>
          <button type="button" class="button ghost" id="btn-cancel-logout">Cancelar</button>
        </div>
      </div>

      ${renderNav('profile')}
    </div>
  `;
}

export function mount(root) {
  mountNavEvents(root);

  // Datos reales: contadores, resúmenes y ajustes guardados en la base de datos
  Promise.all([casesService.listMine(), sightingsService.listMine(), searchesService.myParticipations(), profileService.getSettings()])
    .then(([cases, sights, parts, st]) => {
      const set = (sel, text) => { const el = root.querySelector(sel); if (el) el.textContent = text; };
      const pub = cases.filter((c) => c.status === 'active').length;
      const rev = cases.filter((c) => c.status === 'pending_review').length;
      const res = cases.filter((c) => c.status === 'resolved').length;
      set('#stat-alerts', cases.length); set('#stat-sightings', sights.length); set('#stat-searches', parts.length);
      set('#sub-alerts', cases.length ? `${pub} activas · ${res} resueltas${rev ? ` · ${rev} en revisión` : ''}` : 'Aún no has publicado alertas');
      const inCourse = parts.filter((p) => p.case.status === 'active').length;
      set('#sub-searches', parts.length ? `${inCourse} en curso · ${parts.length - inCourse} finalizadas` : 'Aún no te has unido a ninguna');
      const conf = sights.filter((x) => x.status !== 'received').length;
      set('#sub-sightings', sights.length ? `${sights.length} enviados · ${conf} confirmados` : 'Aún no has enviado avistamientos');
      root.querySelectorAll('#radius-container button').forEach((b) => b.classList.toggle('active', parseInt(b.dataset.r, 10) === st.radiusKm));
      root.querySelector('#toggle-notif')?.classList.toggle('on', st.notifications);
      root.querySelector('#toggle-loc')?.classList.toggle('on', st.location);
    }).catch(() => {});

  // Navegación a sub-pantallas
  root.querySelector('#row-my-alerts')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/alertas';
  });

  root.querySelector('#row-my-searches')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/busquedas';
  });

  root.querySelector('#row-my-sightings')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/avistamientos';
  });

  root.querySelector('#row-edit-profile')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/editar';
  });

  root.querySelector('#row-phone')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/telefono';
  });

  root.querySelector('#row-email')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/correo/cambiar';
  });

  root.querySelector('#row-password')?.addEventListener('click', () => {
    window.location.hash = '#/perfil/contrasena';
  });

  root.querySelector('#row-help')?.addEventListener('click', () => {
    window.location.hash = '#/ayuda';
  });

  root.querySelector('#row-emergency')?.addEventListener('click', () => {
    showToast('Emergencias en Perú: PNP 105, SAMU 106, Bomberos 116', 'info');
  });

  // Selector de radio de alertas
  root.querySelectorAll('#radius-container button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      root.querySelectorAll('#radius-container button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const r = parseInt(btn.dataset.r, 10);
      await profileService.saveSettings({ radiusKm: r });
      showToast(`Radio de alertas actualizado a ${r} km`, 'info');
    });
  });

  // Toggles de notificaciones y ubicación
  const notifToggle = root.querySelector('#toggle-notif');
  const locToggle = root.querySelector('#toggle-loc');

  notifToggle?.addEventListener('click', async () => {
    const isNowOn = !notifToggle.classList.contains('on');
    notifToggle.classList.toggle('on', isNowOn);
    await profileService.saveSettings({ notifications: isNowOn });
    showToast(`Notificaciones ${isNowOn ? 'activadas' : 'desactivadas'}`, 'info');
  });

  locToggle?.addEventListener('click', async () => {
    const isNowOn = !locToggle.classList.contains('on');
    locToggle.classList.toggle('on', isNowOn);
    await profileService.saveSettings({ location: isNowOn });
    showToast(`Uso de ubicación ${isNowOn ? 'activado' : 'desactivado'}`, 'info');
  });

  // Modal de confirmación de cierre de sesión
  const scrim = root.querySelector('#logout-scrim');
  const openLogoutBtn = root.querySelector('#btn-open-logout');
  const cancelLogoutBtn = root.querySelector('#btn-cancel-logout');
  const confirmLogoutBtn = root.querySelector('#btn-confirm-logout');

  openLogoutBtn?.addEventListener('click', () => {
    scrim.style.display = 'flex';
  });

  cancelLogoutBtn?.addEventListener('click', () => {
    scrim.style.display = 'none';
  });

  scrim?.addEventListener('click', (e) => {
    if (e.target === scrim) scrim.style.display = 'none';
  });

  confirmLogoutBtn?.addEventListener('click', async () => {
    scrim.style.display = 'none';
    await authService.logout();
    appState.setSession(null);
    showToast('Sesión cerrada correctamente', 'info');
    window.location.hash = '#/';
  });
}
