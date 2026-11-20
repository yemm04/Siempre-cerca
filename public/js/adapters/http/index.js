/** index.js - Adaptador HTTP: agrupa todos los servicios que hablan con la API REST. */
import { httpAuthAdapter } from './auth.js';
import { httpCasesAdapter } from './cases.js';
import { httpSightingsAdapter } from './sightings.js';
import { httpSearchesAdapter } from './searches.js';
import { httpNotificationsAdapter } from './notifications.js';
import { httpProfileAdapter } from './profile.js';
import { httpAdminAdapter } from './admin.js';

export const api = {
  auth: httpAuthAdapter,
  cases: httpCasesAdapter,
  sightings: httpSightingsAdapter,
  searches: httpSearchesAdapter,
  notifications: httpNotificationsAdapter,
  profile: httpProfileAdapter,
  admin: httpAdminAdapter,
};
