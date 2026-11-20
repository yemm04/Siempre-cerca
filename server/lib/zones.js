// Motor de zonas prioritarias: calcula con fórmulas simples (sin IA) dónde conviene buscar primero.
// Resultado: radio probable, celdas con puntaje (mapa de calor) y el cuadrante sugerido para cada voluntario.

const KM_PER_DEG = 111.32;
const SPEED_KMH = { pet_dog: 1.2, pet_cat: 0.35, child: 2.0, adult: 3.5, elder: 1.6 };   // velocidad "efectiva" de alejamiento
const MAX_KM    = { pet_dog: 5,   pet_cat: 1.5,  child: 6,   adult: 15,  elder: 4 };
const MIN_KM = 0.3;
export const CATEGORY_LABEL = { pet_dog: 'Perro', pet_cat: 'Gato', child: 'Niño o niña', adult: 'Adulto', elder: 'Adulto mayor' };
export const ZONES = ['A1', 'A2', 'B1', 'B2']; // A = norte, B = sur · 1 = oeste, 2 = este (respecto al punto de partida)

export function categoryOf(c) {
  const txt = `${c.breed_or_age || ''} ${c.description || ''}`.toLowerCase();
  if (c.type === 'pet') return /\b(gat[oa]s?|minino|felin[oa])\b/.test(txt) ? 'pet_cat' : 'pet_dog';
  const m = /(\d{1,3})\s*(años|año|anos|ano)\b/.exec(txt);
  const age = m ? Number(m[1]) : null;
  if (age !== null && age < 13) return 'child';
  if (/\b(niñ[oa]|bebé|bebe|menor)\b/.test(txt)) return 'child';
  if ((age !== null && age >= 65) || /\b(abuel[oa]|adulto mayor|anciano|alzheimer|demencia|desorientad[oa])\b/.test(txt)) return 'elder';
  return 'adult';
}

const rad = (d) => (d * Math.PI) / 180;
export function distKm(aLat, aLng, bLat, bLng) {
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * @param c          fila de cases (lat, lng, last_seen_at, type, breed_or_age, description)
 * @param sightings  filas de sightings (lat, lng, created_at, still_there), más recientes primero
 * @param parts      filas de participations (zone, inspected)
 */
export function buildPlan(c, sightings = [], parts = [], now = Date.now()) {
  const category = categoryOf(c);
  // Punto de partida: la pista más reciente si existe; si no, donde se vio por última vez
  const last = sightings[0];
  const anchor = last
    ? { lat: last.lat, lng: last.lng, at: new Date(last.created_at).getTime(), source: 'sighting' }
    : { lat: c.lat, lng: c.lng, at: new Date(c.last_seen_at).getTime(), source: 'lastseen' };
  const hoursSince = Math.max(0.05, (now - anchor.at) / 3600_000);
  const radiusKm = Math.min(MAX_KM[category], Math.max(MIN_KM, SPEED_KMH[category] * hoursSince * 0.55));

  // Rejilla de celdas dentro del círculo (máx. ~6 celdas de radio para que el mapa sea legible)
  const cell = Math.max(0.15, radiusKm / 6);
  const n = Math.ceil(radiusKm / cell);
  const dLat = cell / KM_PER_DEG;
  const dLng = cell / (KM_PER_DEG * Math.cos(rad(anchor.lat)));
  const inspectedZones = new Set(parts.filter((p) => p.inspected).map((p) => p.zone));
  const volunteers = Object.fromEntries(ZONES.map((z) => [z, parts.filter((p) => p.zone === z).length]));

  const cells = [];
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const dx = i * cell, dy = j * cell;
      const d = Math.hypot(dx, dy);
      if (d > radiusKm + cell / 2) continue;
      const lat = anchor.lat + j * dLat, lng = anchor.lng + i * dLng;
      let score = 0.6 * Math.exp(-1.5 * (d / radiusKm) ** 2);
      let boost = 0;
      for (const s of sightings.slice(0, 20)) {
        const ageH = Math.max(0, (now - new Date(s.created_at).getTime()) / 3600_000);
        const w = Math.exp(-ageH / 6) * (s.still_there === 'no' ? 0.5 : 1);
        boost += 0.7 * w * Math.exp(-((distKm(lat, lng, s.lat, s.lng) / 0.5) ** 2));
      }
      score = Math.min(1, score + Math.min(0.5, boost));
      const zone = `${dy >= 0 ? 'A' : 'B'}${dx >= 0 ? 2 : 1}`;
      if (inspectedZones.has(zone)) score *= 0.35;   // ya revisado por voluntarios
      cells.push({ zone, score, bounds: [[lat - dLat / 2, lng - dLng / 2], [lat + dLat / 2, lng + dLng / 2]] });
    }
  }
  cells.forEach((x) => { x.score = Math.round(x.score * 100) / 100; });
  const top = [...cells].sort((a, b) => b.score - a.score).slice(0, 3);
  top.forEach((x) => { x.top = true; });

  // Cuadrante sugerido: el de mayor puntaje total, repartiendo voluntarios (menos gente = más prioridad)
  const zones = ZONES.map((z) => {
    const sum = cells.filter((x) => x.zone === z).reduce((a, x) => a + x.score, 0);
    return { zone: z, score: Math.round(sum * 10) / 10, volunteers: volunteers[z], inspected: inspectedZones.has(z),
      priority: sum / (1 + 0.6 * volunteers[z]) };
  });
  const suggested = [...zones].sort((a, b) => b.priority - a.priority)[0].zone;
  zones.forEach((z) => { z.suggested = z.zone === suggested; delete z.priority; });

  return {
    category, categoryLabel: CATEGORY_LABEL[category],
    center: { lat: anchor.lat, lng: anchor.lng, source: anchor.source },
    origin: { lat: c.lat, lng: c.lng },
    hoursSince, radiusKm: Math.round(radiusKm * 100) / 100,
    cellKm: Math.round(cell * 100) / 100, cells, zones, suggestedZone: suggested,
    sightingsCount: sightings.length,
  };
}

/** Consejos sin IA, según tipo de caso y tiempo transcurrido. */
export function ruleTips(plan) {
  const t = [];
  const h = plan.hoursSince;
  switch (plan.category) {
    case 'pet_dog': t.push('Los perros suelen quedarse a 1–2 km: revisa parques, calles tranquilas y alrededor de tiendas y bodegas.', 'Llévate su comida o juguete favorito y llámalo con voz tranquila; no corras tras él.'); break;
    case 'pet_cat': t.push('Los gatos suelen esconderse muy cerca (pocas cuadras): mira jardines, patios, techos bajos y debajo de autos.', 'Busca con linterna al anochecer, cuando hay más silencio.'); break;
    case 'child': t.push('Un niño avanza poco: revisa parques, tiendas, paraderos y casas de conocidos cercanas.', 'Avisa a la Policía (105) cuanto antes y no busques solo.'); break;
    case 'elder': t.push('Una persona mayor desorientada suele caminar en línea recta y no pedir ayuda: revisa bancas, paraderos, farmacias y mercados.', 'Avisa a la Policía (105) y busca acompañado.'); break;
    default: t.push('Revisa paraderos, estaciones, parques y comercios; pregunta a vigilantes y porteros si lo vieron.', 'Si es posible, ve acompañado y avisa a la Policía (105).');
  }
  if (h < 3) t.push('Están pasando las primeras horas: lo más probable es que siga cerca del punto de partida. Empieza por el cuadrante sugerido.');
  else if (h > 24) t.push('Pasó más de un día: el radio ya es grande. Comparte la alerta con vecinos de otras zonas y revisa lugares más lejanos.');
  if (plan.sightingsCount) t.push('Hay pistas recientes: concéntrate en las celdas más intensas del mapa, cerca del último avistamiento.');
  t.push('Marca tu cuadrante como inspeccionado al terminar, y reporta con foto si lo ves. No lo persigas.');
  return t.map((x) => `• ${x}`).join('\n');
}
