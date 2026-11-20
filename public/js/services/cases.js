/**
 * cases.js - Servicio de casos y alertas comunitarias
 * Interfaz utilizada por las pantallas para listar, crear y actualizar alertas.
 */
import { api } from './index.js';

export const casesService = {
  listActive: (params) => api.cases.listActive(params),
  get: (id) => api.cases.get(id),
  create: (data) => api.cases.create(data),
  listMine: () => api.cases.listMine(),
  community: (loc) => api.cases.community(loc),
  report: (id, reason) => api.cases.report(id, reason),
  markResolved: (id, note) => api.cases.markResolved(id, note),
  renew: (id) => api.cases.renew(id),
  plan: (id) => api.cases.plan(id),
  tips: (id) => api.cases.tips(id),
  summary: (id) => api.cases.summary(id),
  ask: (message) => api.cases.ask(message),
};
