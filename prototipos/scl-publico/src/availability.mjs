import { findProperty, properties } from './catalog.mjs';
export function todayInRio(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function validDay(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s ?? '') && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
}
export function validateSearch(params, today = todayInRio()) {
  const errors = [];
  for (const key of ['property', 'checkin', 'checkout', 'guests']) if (params.getAll(key).length > 1) errors.push('Parâmetros duplicados não são aceitos.');
  const checkin = params.get('checkin') || '', checkout = params.get('checkout') || '';
  const rawGuests = params.get('guests') || '', guests = Number(rawGuests);
  const code = params.get('property') || '', property = code ? findProperty(code) : null;
  if (code && !property) errors.push('Escolha um imóvel do catálogo.');
  if (!validDay(checkin) || !validDay(checkout)) errors.push('Informe datas válidas de entrada e saída.');
  else {
    if (checkin < today) errors.push('A entrada não pode estar no passado.');
    if (checkout <= checkin) errors.push('A saída deve ser depois da entrada.');
    if ((Date.parse(checkout)-Date.parse(checkin))/86400000 > 90) errors.push('Para estadias acima de 90 noites, consulte a equipe.');
  }
  if (!/^[1-6]$/.test(rawGuests)) errors.push('Informe de 1 a 6 hóspedes.');
  else if (property && guests > property.capacity) errors.push(`Este imóvel recebe até ${property.capacity} hóspedes.`);
  return { errors, query: { property, checkin, checkout, guests } };
}
// Provider boundary only: no credential, remote call, fake dates or commercial quote.
// Implement Beds24 behind this interface after mappings and API contract validation.
export class Beds24AvailabilityProvider {
  async readAvailability({ propertyIds, checkin, checkout, guests }) {
    return { state: 'UNKNOWN', reason: 'PROVIDER_NOT_CONFIGURED', checkedAt: null, propertyIds, checkin, checkout, guests };
  }
}
export async function getAvailability(query, provider = new Beds24AvailabilityProvider()) {
  const propertyIds = query.property ? [query.property.id] : properties.filter(p => p.capacity >= query.guests).map(p => p.id);
  try {
    const result = await provider.readAvailability({ propertyIds, checkin: query.checkin, checkout: query.checkout, guests: query.guests });
    // Fail closed until a real provider response and freshness policy are approved.
    return { state: 'UNKNOWN', reason: result?.reason === 'PROVIDER_NOT_CONFIGURED' ? result.reason : 'PROVIDER_UNVERIFIED', checkedAt: null, canBook: false };
  } catch { return { state: 'UNKNOWN', reason: 'PROVIDER_UNAVAILABLE', checkedAt: null, canBook: false }; }
}
