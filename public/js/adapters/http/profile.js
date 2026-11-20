/** profile.js - Adaptador HTTP de perfil y ajustes */
import { get, patch, post } from './client.js';

export const httpProfileAdapter = {
  update: ({ name, username }) => patch('/me', { name, username }),
  getSettings: () => get('/me/settings'),
  saveSettings: (settings) => patch('/me/settings', settings),
  /** Guarda la zona aproximada del usuario para avisarle de alertas cercanas */
  async saveLocation(lat, lng) { try { await post('/me/location', { lat, lng }); } catch { /* opcional */ } },
};
