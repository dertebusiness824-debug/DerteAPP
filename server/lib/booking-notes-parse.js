/**
 * Extract customer email, vehicle make/model and Spanish plate from free-text
 * booking notes / Google Calendar descriptions.
 */

const SPANISH_PLATE_RE = /\b(\d{4})\s*([BCDFGHJKLMNPRSTVWXYZ]{3})\b/i;
const LEGACY_PLATE_RE = /\b([A-Z]{1,2})\s*[- ]?\s*(\d{4})\s*[- ]?\s*([A-Z]{1,2})\b/i;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** Common makes seen on Spanish workshop bookings (longest first for matching). */
const CAR_MAKES = [
  'alfa romeo',
  'land rover',
  'mercedes-benz',
  'mercedes',
  'volkswagen',
  'mitsubishi',
  'chevrolet',
  'ssangyong',
  'citroen',
  'citroën',
  'hyundai',
  'porsche',
  'peugeot',
  'renault',
  'suzuki',
  'toyota',
  'nissan',
  'jaguar',
  'skoda',
  'škoda',
  'subaru',
  'mazda',
  'volvo',
  'honda',
  'lexus',
  'dacia',
  'fiat',
  'ford',
  'audi',
  'seat',
  'opel',
  'bmw',
  'kia',
  'mini',
  'jeep',
  'cupra',
  'tesla',
  'smart',
  'vw',
].sort((a, b) => b.length - a.length);

export function plainBookingText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function extractPlate(text) {
  const labelled = text.match(
    /(?:matr[ií]cula|plate|n[ºo°]?\s*placa|registration)\s*[:\-–]\s*([A-Z0-9][A-Z0-9 -]{4,11})/i,
  );
  if (labelled) return labelled[1].replace(/[ -]+/g, '').toUpperCase();

  const modern = text.match(SPANISH_PLATE_RE);
  if (modern) return `${modern[1]}${modern[2].toUpperCase()}`;

  const legacy = text.match(LEGACY_PLATE_RE);
  if (legacy) return `${legacy[1].toUpperCase()}${legacy[2]}${legacy[3].toUpperCase()}`;

  return null;
}

function extractEmail(text) {
  const labelled = text.match(
    /(?:e-?mail|correo(?:\s+electr[oó]nico)?)\s*[:\-–]\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i,
  );
  if (labelled) return labelled[1].toLowerCase().slice(0, 180);

  const bare = text.match(EMAIL_RE);
  return bare ? bare[0].toLowerCase().slice(0, 180) : null;
}

function extractVehicle(text, plate) {
  let vehicle_make = null;
  let vehicle_model = null;

  const makeMatch = text.match(/(?:marca|make)\s*[:\-–]\s*([^\n,;|/]+)/i);
  const modelMatch = text.match(/(?:modelo|model)\s*[:\-–]\s*([^\n,;|/]+)/i);
  const vehicleMatch = text.match(/(?:veh[ií]culo|coche|vehicle|auto)\s*[:\-–]\s*([^\n;|/]+)/i);

  if (makeMatch) vehicle_make = makeMatch[1].trim().slice(0, 60) || null;
  if (modelMatch) vehicle_model = modelMatch[1].trim().slice(0, 60) || null;

  if (!vehicle_make && !vehicle_model && vehicleMatch) {
    const cleaned = vehicleMatch[1]
      .replace(SPANISH_PLATE_RE, ' ')
      .replace(LEGACY_PLATE_RE, ' ')
      .replace(/[·•|/]+/g, ' ')
      .trim();
    const bits = cleaned.split(/\s+/).filter(Boolean);
    if (bits.length === 1) vehicle_model = bits[0].slice(0, 60);
    else if (bits.length > 1) {
      vehicle_make = bits[0].slice(0, 60);
      vehicle_model = bits.slice(1).join(' ').slice(0, 60);
    }
  }

  // Free-form "opel corsa" / "Opel Corsa 4961GGJ" anywhere in the note.
  if (!vehicle_make && !vehicle_model) {
    const lower = text.toLowerCase();
    for (const make of CAR_MAKES) {
      const idx = lower.indexOf(make);
      if (idx === -1) continue;
      // Avoid matching inside longer words.
      const before = idx === 0 ? ' ' : lower[idx - 1];
      const after = lower[idx + make.length] ?? ' ';
      if (/[a-záéíóúüñ]/i.test(before) || /[a-záéíóúüñ]/i.test(after)) continue;

      const rest = text.slice(idx + make.length).trim();
      const modelBits = [];
      for (const token of rest.split(/[\s,;/|]+/)) {
        if (!token) continue;
        if (EMAIL_RE.test(token)) break;
        if (SPANISH_PLATE_RE.test(token) || (plate && token.toUpperCase().replace(/\s/g, '') === plate)) break;
        if (/^(matr[ií]cula|email|correo|tel[eé]fono|phone|cliente|notas?)$/i.test(token)) break;
        if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9.-]{1,24}$/.test(token)) break;
        modelBits.push(token);
        if (modelBits.length >= 3) break;
      }
      vehicle_make = make.replace(/\b\w/g, (ch) => ch.toUpperCase()).slice(0, 60);
      // Keep original casing for known ascii makes.
      if (make === 'vw') vehicle_make = 'VW';
      if (make === 'bmw') vehicle_make = 'BMW';
      if (make === 'opel') vehicle_make = 'Opel';
      if (make === 'seat') vehicle_make = 'Seat';
      vehicle_model = modelBits.length ? modelBits.join(' ').slice(0, 60) : null;
      break;
    }
  }

  // Text before a known plate: "opel corsa 4961GGJ"
  if (!vehicle_make && !vehicle_model && plate) {
    const around = text.match(
      new RegExp(
        `([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9. ]{1,40})\\s+${plate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'i',
      ),
    );
    if (around) {
      const bits = around[1].trim().split(/\s+/).filter(Boolean);
      if (bits.length >= 2) {
        vehicle_make = bits[0].slice(0, 60);
        vehicle_model = bits.slice(1).join(' ').slice(0, 60);
      } else if (bits.length === 1) {
        vehicle_model = bits[0].slice(0, 60);
      }
    }
  }

  return { vehicle_make, vehicle_model, vehicle_plate: plate };
}

/**
 * @returns {{ email: string|null, vehicle_make: string|null, vehicle_model: string|null, vehicle_plate: string|null }}
 */
export function parseBookingNotes(description) {
  const text = plainBookingText(description);
  if (!text) {
    return { email: null, vehicle_make: null, vehicle_model: null, vehicle_plate: null };
  }

  const vehicle_plate = extractPlate(text);
  const email = extractEmail(text);
  const vehicle = extractVehicle(text, vehicle_plate);

  return {
    email,
    vehicle_make: vehicle.vehicle_make,
    vehicle_model: vehicle.vehicle_model,
    vehicle_plate: vehicle.vehicle_plate,
  };
}
