/**
 * index.js - Punto único de acceso a los datos.
 * Todas las pantallas usan los servicios; los servicios usan este adaptador (API REST + PostgreSQL).
 */
export { api } from '../adapters/http/index.js';
