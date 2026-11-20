/**
 * config.js - Configuración central de Siempre Cerca
 * Constantes de geolocalización de Lima (Perú), límites y claves de almacenamiento.
 */
export const CONFIG = {
  API_BASE_URL: '/api',

  // Correo de soporte que se muestra en el Centro de ayuda (cámbialo por el tuyo)
  SUPPORT_EMAIL: 'ayuda@siemprecerca.app',

  // Roles que pueden entrar al panel de administración
  STAFF_ROLES: ['moderator', 'admin'],

  // Coordenadas iniciales: Miraflores, Lima, Perú
  LIMA_CENTER: {
    lat: -12.1197,
    lng: -77.0372,
  },

  // Límites geográficos del Perú para restringir el mapa Leaflet
  PERU_BOUNDS: [
    [-18.5, -81.5], // Suroeste
    [0.0, -68.5],   // Noreste
  ],

  DEFAULT_ZOOM: 14,
  MIN_ZOOM: 5,
  MAX_ZOOM: 18,

  // Centrales de emergencia oficiales de Perú
  EMERGENCIES: {
    POLICE: '105',
    FIREFIGHTERS: '116',
    SAMU: '106',
  },

  DEFAULT_RADIUS_KM: 5,
};
