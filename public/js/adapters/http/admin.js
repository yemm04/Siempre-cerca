/** admin.js - Adaptador HTTP del panel de administración (el servidor valida el rol en cada ruta) */
import { get, patch, del } from './client.js';

const id = encodeURIComponent;
export const httpAdminAdapter = {
  stats: () => get('/admin/stats'),
  listCases: ({ status = 'all', q = '' } = {}) => get('/admin/cases', { status, q }),
  reviewCase: (caseId, { decision, reason = '' }) => patch(`/admin/cases/${id(caseId)}/review`, { decision, reason }),
  resolveCase: (caseId) => patch(`/admin/cases/${id(caseId)}/resolve`, {}),
  async deleteCase(caseId) { await del(`/admin/cases/${id(caseId)}`); return true; },
  listUsers: ({ status = 'all', q = '' } = {}) => get('/admin/users', { status, q }),
  setUserStatus: (userId, status, reason = '') => patch(`/admin/users/${id(userId)}/status`, { status, reason }),
  listSightings: ({ status = 'all', q = '' } = {}) => get('/admin/sightings', { status, q }),
  setSightingStatus: (sid, status) => patch(`/admin/sightings/${id(sid)}/status`, { status }),
  listAudit: (limit = 12) => get('/admin/audit', { limit }),
};
