/**
 * Spanish licence-plate parsing.
 *
 * Two formats matter in a workshop:
 *   - national, since September 2000: 4 digits + 3 consonants (1234 BCD)
 *   - provincial, 1971–2000: province code + 4 digits + 1–2 letters (M 1234 AB)
 *
 * Nothing here invents a make or model: the plate only tells us the format and,
 * for provincial plates, the province of first registration. The model comes
 * from the shop's own history, the catalog, or an external lookup provider.
 */

/** Letters used by the national series (vowels and Q are excluded). */
export const SERIES_LETTERS = 'BCDFGHJKLMNPRSTVWXYZ';

const NATIONAL = new RegExp(`^(\\d{4})([${SERIES_LETTERS}]{3})$`);
const PROVINCIAL = /^([A-Z]{1,2})(\d{4})([A-Z]{1,2})$/;
const TRAILER = /^R(\d{4})([A-Z]{2,3})$/;

/** Province codes used until 2000. Still stamped on plenty of cars in service. */
export const PROVINCE_CODES = {
  A: 'Alicante',
  AB: 'Albacete',
  AL: 'Almería',
  AV: 'Ávila',
  B: 'Barcelona',
  BA: 'Badajoz',
  BI: 'Bizkaia',
  BU: 'Burgos',
  C: 'A Coruña',
  CA: 'Cádiz',
  CC: 'Cáceres',
  CE: 'Ceuta',
  CO: 'Córdoba',
  CR: 'Ciudad Real',
  CS: 'Castellón',
  CU: 'Cuenca',
  GC: 'Las Palmas',
  GE: 'Girona',
  GI: 'Girona',
  GR: 'Granada',
  GU: 'Guadalajara',
  H: 'Huelva',
  HU: 'Huesca',
  IB: 'Illes Balears',
  J: 'Jaén',
  L: 'Lleida',
  LE: 'León',
  LO: 'La Rioja',
  LU: 'Lugo',
  M: 'Madrid',
  MA: 'Málaga',
  ML: 'Melilla',
  MU: 'Murcia',
  NA: 'Navarra',
  O: 'Asturias',
  OR: 'Ourense',
  OU: 'Ourense',
  P: 'Palencia',
  PM: 'Illes Balears',
  PO: 'Pontevedra',
  S: 'Cantabria',
  SA: 'Salamanca',
  SE: 'Sevilla',
  SG: 'Segovia',
  SO: 'Soria',
  SS: 'Gipuzkoa',
  T: 'Tarragona',
  TE: 'Teruel',
  TF: 'Santa Cruz de Tenerife',
  TO: 'Toledo',
  V: 'València',
  VA: 'Valladolid',
  VI: 'Araba/Álava',
  Z: 'Zaragoza',
  ZA: 'Zamora',
};

/** Uppercase, separator-free form used as the storage key. */
export function normalizePlate(value) {
  const raw = String(value ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return raw || null;
}

/** Human form with the usual spacing: "1234 BCD", "M 1234 AB". */
export function formatPlate(value) {
  const plate = normalizePlate(value);
  if (!plate) return null;

  const national = NATIONAL.exec(plate);
  if (national) return `${national[1]} ${national[2]}`;

  const provincial = PROVINCIAL.exec(plate);
  if (provincial) return `${provincial[1]} ${provincial[2]} ${provincial[3]}`;

  return plate;
}

/**
 * Describes a plate without guessing what car wears it.
 * `format` is 'national' | 'provincial' | 'trailer' | 'unknown'.
 */
export function parsePlate(value) {
  const plate = normalizePlate(value);
  if (!plate) {
    return { plate: null, valid: false, format: 'unknown', display: null };
  }

  const national = NATIONAL.exec(plate);
  if (national) {
    return {
      plate,
      valid: true,
      format: 'national',
      display: formatPlate(plate),
      series: national[2],
      // The national format started in September 2000, so this is a hard floor.
      registered_after: 2000,
      province: null,
    };
  }

  const provincial = PROVINCIAL.exec(plate);
  if (provincial && PROVINCE_CODES[provincial[1]]) {
    return {
      plate,
      valid: true,
      format: 'provincial',
      display: formatPlate(plate),
      series: provincial[3],
      // Provincial plates stopped being issued in September 2000.
      registered_before: 2001,
      province: PROVINCE_CODES[provincial[1]],
      province_code: provincial[1],
    };
  }

  const trailer = TRAILER.exec(plate);
  if (trailer) {
    return { plate, valid: true, format: 'trailer', display: plate, province: null };
  }

  return { plate, valid: false, format: 'unknown', display: plate, province: null };
}

export const isValidPlate = (value) => parsePlate(value).valid;
