/** cases.js - Adaptador HTTP de alertas */
import { get, post } from './client.js';

export const httpCasesAdapter = {
  listActive: ({ lat, lng, radiusKm, type, q } = {}) => get('/cases', { lat, lng, radiusKm, type, q }),
  async get(id) { try { return await get(`/cases/${encodeURIComponent(id)}`); } catch (e) { if (e.status === 404) return null; throw e; } },
  create(data) {
    // La fecha local del formulario se convierte a hora universal para que el servidor la entienda
    const lastSeenAt = data.lastSeenAt ? new Date(data.lastSeenAt).toISOString() : new Date().toISOString();
    return post('/cases', { ...data, lastSeenAt });
  },
  listMine: () => get('/cases/mine'),
  markResolved: (id, note) => post(`/cases/${encodeURIComponent(id)}/resolve`, { note }),
  community: ({ lat, lng } = {}) => get('/community', { lat, lng }),
  report: (id, reason) => post(`/cases/${encodeURIComponent(id)}/report`, { reason }),
  renew: (id) => post(`/cases/${encodeURIComponent(id)}/renew`, {}),
  plan: (id) => get(`/cases/${encodeURIComponent(id)}/plan`),
  tips: (id) => get(`/cases/${encodeURIComponent(id)}/tips`),
  summary: (id) => get(`/cases/${encodeURIComponent(id)}/summary`),
  ask: (message) => post('/assistant', { message }),
};
