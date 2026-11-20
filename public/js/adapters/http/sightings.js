/** sightings.js - Adaptador HTTP de avistamientos */
import { get, post } from './client.js';

export const httpSightingsAdapter = {
  create: (caseId, data) => post(`/cases/${encodeURIComponent(caseId)}/sightings`, data),
  listMine: () => get('/sightings/mine'),
  listForCase: (caseId) => get(`/cases/${encodeURIComponent(caseId)}/sightings`),
};
