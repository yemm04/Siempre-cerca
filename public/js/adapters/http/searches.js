/** searches.js - Adaptador HTTP de búsqueda en equipo */
import { get, post } from './client.js';

export const httpSearchesAdapter = {
  join: (caseId, zone) => post(`/cases/${encodeURIComponent(caseId)}/join`, { zone }),
  myParticipations: () => get('/searches/mine'),
  markZoneInspected: (caseId, zone) => post(`/cases/${encodeURIComponent(caseId)}/inspect`, { zone }),
  volunteers: (caseId) => get(`/cases/${encodeURIComponent(caseId)}/volunteers`),
};
