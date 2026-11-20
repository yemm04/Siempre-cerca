/** notifications.js - Adaptador HTTP de notificaciones */
import { get, post } from './client.js';

export const httpNotificationsAdapter = {
  list: () => get('/notifications'),
  async markAllRead() { await post('/notifications/read-all', {}); return true; },
  async markRead(id) { await post(`/notifications/${encodeURIComponent(id)}/read`, {}); return true; },
};
