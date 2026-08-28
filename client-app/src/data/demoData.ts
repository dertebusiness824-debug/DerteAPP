/**
 * Catálogo de demostración.
 *
 * Se usa cuando la app arranca sin credenciales de Supabase (modo demo), igual
 * que `npm run seed -- --demo` en el panel B2B: permite desarrollar y revisar
 * la interfaz sin depender de la red. La app avisa en pantalla cuando está en
 * este modo.
 */
import type { ShopListing, ShopReview, ShopService, WeeklyHour } from './types';

type HoursPreset = 'estandar' | 'ampliado' | 'sabados' | 'continuo';

interface ServiceSeed {
  slug: string;
  name: string;
  from: number | null;
  to?: number | null;
  duration?: number;
  description?: string;
}

interface ShopSeed {
  id: string;
  name: string;
  city: string;
  neighborhood: string;
  address: string;
  phone: string;
  latitude: number;
  longitude: number;
  rating: number;
  ratingCount: number;
  urgent: boolean;
  headline: string;
  description: string;
  hours: HoursPreset;
  capacity: number;
  slotMinutes: number;
  minNoticeMinutes: number;
  services: ServiceSeed[];
  reviews: Array<{ author: string; rating: number; comment: string; tag?: string; daysAgo: number }>;
}

function hoursFor(preset: HoursPreset): WeeklyHour[] {
  const closed = (weekday: number): WeeklyHour => ({
    weekday,
    isClosed: true,
    openTime: null,
    closeTime: null,
    breakStart: null,
    breakEnd: null,
  });
  const day = (
    weekday: number,
    openTime: string,
    closeTime: string,
    breakStart: string | null = null,
    breakEnd: string | null = null,
  ): WeeklyHour => ({ weekday, isClosed: false, openTime, closeTime, breakStart, breakEnd });

  switch (preset) {
    case 'ampliado':
      return [
        closed(0),
        ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, '07:30', '20:30')),
        day(6, '09:00', '14:00'),
      ];
    case 'sabados':
      return [
        day(0, '10:00', '14:00'),
        ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, '09:00', '19:00', '14:00', '15:30')),
        day(6, '09:00', '18:00'),
      ];
    case 'continuo':
      return [0, 1, 2, 3, 4, 5, 6].map((weekday) => day(weekday, '00:00', '23:30'));
    case 'estandar':
    default:
      return [
        closed(0),
        ...[1, 2, 3, 4, 5].map((weekday) => day(weekday, '08:00', '19:00', '13:30', '15:00')),
        day(6, '09:00', '14:00'),
      ];
  }
}

const OIL: ServiceSeed = {
  slug: 'cambio-aceite',
  name: 'Cambio de aceite y filtros',
  from: 69,
  to: 119,
  duration: 60,
  description: 'Aceite sintético, filtro de aceite y revisión de niveles.',
};
const BRAKES: ServiceSeed = {
  slug: 'frenos',
  name: 'Pastillas de frenos (eje)',
  from: 89,
  to: 160,
  duration: 90,
  description: 'Sustitución de pastillas delanteras o traseras y purgado.',
};
const TYRES: ServiceSeed = {
  slug: 'neumaticos',
  name: 'Neumáticos y equilibrado',
  from: 55,
  to: null,
  duration: 45,
  description: 'Precio por rueda montada, equilibrada y con válvula nueva.',
};
const ITV: ServiceSeed = {
  slug: 'itv',
  name: 'Revisión pre-ITV',
  from: 39,
  to: null,
  duration: 45,
  description: 'Comprobación de los 32 puntos que revisa la ITV.',
};
const DIAG: ServiceSeed = {
  slug: 'diagnosis',
  name: 'Diagnosis electrónica',
  from: 45,
  to: null,
  duration: 60,
  description: 'Lectura de centralita y presupuesto de la avería.',
};
const AC: ServiceSeed = {
  slug: 'aire-acondicionado',
  name: 'Carga de aire acondicionado',
  from: 79,
  to: 129,
  duration: 60,
};
const BATTERY: ServiceSeed = {
  slug: 'bateria',
  name: 'Batería y test de carga',
  from: 95,
  to: 180,
  duration: 30,
};
const BODY: ServiceSeed = {
  slug: 'chapa',
  name: 'Chapa y pintura (pieza)',
  from: 180,
  to: 420,
  duration: 240,
};

const SEEDS: ShopSeed[] = [
  {
    id: 'demo-shop-chamberi',
    name: 'Taller Central Chamberí',
    city: 'Madrid',
    neighborhood: 'Chamberí',
    address: 'Calle de Bravo Murillo 12',
    phone: '+34910450112',
    latitude: 40.4378,
    longitude: -3.7036,
    rating: 4.8,
    ratingCount: 214,
    urgent: true,
    headline: 'Mecánica rápida, diagnosis y grúa 24h',
    description:
      'Taller multimarca con 18 años en el barrio. Diagnosis en el día, coche de cortesía y presupuesto por escrito antes de tocar nada.',
    hours: 'ampliado',
    capacity: 3,
    slotMinutes: 60,
    minNoticeMinutes: 60,
    services: [OIL, BRAKES, DIAG, TYRES, AC],
    reviews: [
      {
        author: 'Lucía F.',
        rating: 5,
        comment: 'Me atendieron con el coche parado en plena M-30. En dos horas estaba arreglado.',
        tag: 'Diagnosis electrónica',
        daysAgo: 3,
      },
      {
        author: 'Marcos R.',
        rating: 5,
        comment: 'Precio clavado al presupuesto. Me avisaron por teléfono antes de cambiar la pieza.',
        tag: 'Pastillas de frenos (eje)',
        daysAgo: 11,
      },
      {
        author: 'Nerea B.',
        rating: 4,
        comment: 'Muy buen trato. El único pero es que la sala de espera es pequeña.',
        daysAgo: 26,
      },
    ],
  },
  {
    id: 'demo-shop-salamanca',
    name: 'AutoPremium Salamanca',
    city: 'Madrid',
    neighborhood: 'Salamanca',
    address: 'Calle de Alcántara 47',
    phone: '+34910450220',
    latitude: 40.4302,
    longitude: -3.6763,
    rating: 4.6,
    ratingCount: 158,
    urgent: false,
    headline: 'Especialistas en marcas alemanas',
    description:
      'Servicio oficial para BMW, Audi y Mercedes. Recogemos y entregamos el coche en tu domicilio dentro del distrito.',
    hours: 'estandar',
    capacity: 2,
    slotMinutes: 90,
    minNoticeMinutes: 120,
    services: [OIL, DIAG, BRAKES, AC, BODY],
    reviews: [
      {
        author: 'Javier M.',
        rating: 5,
        comment: 'Recogieron el coche en casa y me lo devolvieron lavado. Impecable.',
        daysAgo: 6,
      },
      {
        author: 'Sofía L.',
        rating: 4,
        comment: 'Buen trabajo, algo más caro que la media del barrio.',
        tag: 'Cambio de aceite y filtros',
        daysAgo: 19,
      },
    ],
  },
  {
    id: 'demo-shop-tetuan',
    name: 'Neumáticos Tetuán Express',
    city: 'Madrid',
    neighborhood: 'Tetuán',
    address: 'Avenida de Asturias 30',
    phone: '+34910450318',
    latitude: 40.4601,
    longitude: -3.7008,
    rating: 4.4,
    ratingCount: 302,
    urgent: true,
    headline: 'Neumáticos en 30 minutos sin cita',
    description:
      'Stock de más de 2.000 neumáticos. Montaje, equilibrado y alineación mientras esperas.',
    hours: 'sabados',
    capacity: 4,
    slotMinutes: 30,
    minNoticeMinutes: 30,
    services: [TYRES, BATTERY, ITV, BRAKES],
    reviews: [
      {
        author: 'Diego P.',
        rating: 5,
        comment: 'Pinchazo un domingo por la mañana y me lo solucionaron en media hora.',
        tag: 'Neumáticos y equilibrado',
        daysAgo: 2,
      },
      {
        author: 'Carmen S.',
        rating: 4,
        comment: 'Rápidos y baratos. Hay que llamar antes porque se llena.',
        daysAgo: 14,
      },
    ],
  },
  {
    id: 'demo-shop-arganzuela',
    name: 'Electromecánica Arganzuela',
    city: 'Madrid',
    neighborhood: 'Arganzuela',
    address: 'Paseo de las Delicias 88',
    phone: '+34910450477',
    latitude: 40.3966,
    longitude: -3.6944,
    rating: 4.9,
    ratingCount: 96,
    urgent: false,
    headline: 'Diagnosis y electrónica del automóvil',
    description:
      'Nos llaman otros talleres cuando la avería es eléctrica. Equipos de diagnosis de fabricante y presupuesto cerrado.',
    hours: 'estandar',
    capacity: 2,
    slotMinutes: 60,
    minNoticeMinutes: 180,
    services: [DIAG, BATTERY, AC, OIL],
    reviews: [
      {
        author: 'Andrés V.',
        rating: 5,
        comment: 'Encontraron un cortocircuito que otros dos talleres no supieron localizar.',
        tag: 'Diagnosis electrónica',
        daysAgo: 8,
      },
      {
        author: 'Paula T.',
        rating: 5,
        comment: 'Explican todo con calma y sin vender de más.',
        daysAgo: 33,
      },
    ],
  },
  {
    id: 'demo-shop-vallecas',
    name: 'Talleres Vallecas 24h',
    city: 'Madrid',
    neighborhood: 'Vallecas',
    address: 'Calle Sierra de Guadalupe 3',
    phone: '+34910450501',
    latitude: 40.3878,
    longitude: -3.6389,
    rating: 4.2,
    ratingCount: 187,
    urgent: true,
    headline: 'Asistencia en carretera las 24 horas',
    description:
      'Grúa propia y taller abierto toda la noche. Atendemos averías urgentes en toda la M-40 sur.',
    hours: 'continuo',
    capacity: 2,
    slotMinutes: 60,
    minNoticeMinutes: 30,
    services: [BRAKES, TYRES, BATTERY, DIAG, OIL],
    reviews: [
      {
        author: 'Rubén A.',
        rating: 5,
        comment: 'Les llamé a las 3 de la mañana y vinieron con la grúa en 25 minutos.',
        tag: 'Batería y test de carga',
        daysAgo: 1,
      },
      {
        author: 'Elena C.',
        rating: 3,
        comment: 'Solucionaron la avería, pero tardaron en darme el presupuesto.',
        daysAgo: 21,
      },
    ],
  },
  {
    id: 'demo-shop-carabanchel',
    name: 'Chapa y Pintura Carabanchel',
    city: 'Madrid',
    neighborhood: 'Carabanchel',
    address: 'Calle General Ricardos 210',
    phone: '+34910450644',
    latitude: 40.3852,
    longitude: -3.7285,
    rating: 4.5,
    ratingCount: 74,
    urgent: false,
    headline: 'Carrocería, granizo y peritajes de seguro',
    description:
      'Cabina de pintura al agua y gestión completa del parte con tu aseguradora. Coche de sustitución incluido.',
    hours: 'estandar',
    capacity: 1,
    slotMinutes: 120,
    minNoticeMinutes: 240,
    services: [BODY, ITV, OIL],
    reviews: [
      {
        author: 'Iván G.',
        rating: 5,
        comment: 'Repararon el granizo del capó y no se nota nada. Gestión del seguro incluida.',
        tag: 'Chapa y pintura (pieza)',
        daysAgo: 12,
      },
    ],
  },
  {
    id: 'demo-shop-eixample',
    name: 'Motor Eixample',
    city: 'Barcelona',
    neighborhood: 'Eixample',
    address: 'Carrer de Provença 401',
    phone: '+34931220145',
    latitude: 41.4046,
    longitude: 2.1786,
    rating: 4.7,
    ratingCount: 131,
    urgent: true,
    headline: 'Mantenimiento y pre-ITV en el día',
    description:
      'Taller de barrio con precios publicados. Reserva por la mañana y recoge el coche por la tarde.',
    hours: 'ampliado',
    capacity: 3,
    slotMinutes: 60,
    minNoticeMinutes: 60,
    services: [ITV, OIL, BRAKES, TYRES, DIAG],
    reviews: [
      {
        author: 'Martí O.',
        rating: 5,
        comment: 'Pasé la pre-ITV y me arreglaron dos cosas en el mismo día.',
        tag: 'Revisión pre-ITV',
        daysAgo: 4,
      },
      {
        author: 'Aina R.',
        rating: 4,
        comment: 'Precio transparente, sin sorpresas en la factura.',
        daysAgo: 17,
      },
    ],
  },
  {
    id: 'demo-shop-gracia',
    name: 'Gràcia Auto Servei',
    city: 'Barcelona',
    neighborhood: 'Gràcia',
    address: "Carrer Gran de Gràcia 190",
    phone: '+34931220288',
    latitude: 41.4085,
    longitude: 2.1521,
    rating: 4.3,
    ratingCount: 88,
    urgent: false,
    headline: 'Coches híbridos y eléctricos',
    description: 'Personal certificado en alta tensión y punto de carga para clientes.',
    hours: 'estandar',
    capacity: 2,
    slotMinutes: 60,
    minNoticeMinutes: 120,
    services: [DIAG, BATTERY, OIL, AC],
    reviews: [
      {
        author: 'Pau S.',
        rating: 4,
        comment: 'Uno de los pocos sitios donde saben tocar un híbrido sin miedo.',
        daysAgo: 9,
      },
    ],
  },
  {
    id: 'demo-shop-ruzafa',
    name: 'Ruzafa Mecànics',
    city: 'Valencia',
    neighborhood: 'Ruzafa',
    address: 'Carrer de Sueca 55',
    phone: '+34961180233',
    latitude: 39.4595,
    longitude: -0.3736,
    rating: 4.6,
    ratingCount: 64,
    urgent: true,
    headline: 'Mecánica general y aire acondicionado',
    description: 'Especialistas en clima. Revisión de aire gratuita antes del verano.',
    hours: 'sabados',
    capacity: 2,
    slotMinutes: 60,
    minNoticeMinutes: 60,
    services: [AC, OIL, BRAKES, ITV],
    reviews: [
      {
        author: 'Vicent LL.',
        rating: 5,
        comment: 'El aire volvió a enfriar como el primer día y me cobraron lo presupuestado.',
        tag: 'Carga de aire acondicionado',
        daysAgo: 5,
      },
    ],
  },
  {
    id: 'demo-shop-nervion',
    name: 'Talleres Nervión',
    city: 'Sevilla',
    neighborhood: 'Nervión',
    address: 'Avenida de la Buhaira 18',
    phone: '+34954330190',
    latitude: 37.3826,
    longitude: -5.975,
    rating: 4.1,
    ratingCount: 52,
    urgent: false,
    headline: 'Mantenimiento con cita en 24h',
    description: 'Taller familiar con tarifa plana de mano de obra y garantía de dos años.',
    hours: 'estandar',
    capacity: 2,
    slotMinutes: 60,
    minNoticeMinutes: 60,
    services: [OIL, TYRES, ITV, BATTERY],
    reviews: [
      {
        author: 'Rocío J.',
        rating: 4,
        comment: 'Cumplieron el plazo y el precio. Repetiré.',
        daysAgo: 15,
      },
    ],
  },
];

function toService(shopId: string, seed: ServiceSeed): ShopService {
  return {
    id: `${shopId}-${seed.slug}`,
    slug: seed.slug,
    name: seed.name,
    description: seed.description ?? null,
    priceFrom: seed.from,
    priceTo: seed.to ?? null,
    currency: 'EUR',
    durationMinutes: seed.duration ?? null,
  };
}

export function buildDemoShops(): ShopListing[] {
  return SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    slug: seed.id,
    phone: seed.phone,
    whatsappPhone: seed.phone,
    email: null,
    address: seed.address,
    city: seed.city,
    neighborhood: seed.neighborhood,
    timezone: 'Europe/Madrid',
    websiteUrl: null,
    latitude: seed.latitude,
    longitude: seed.longitude,
    headline: seed.headline,
    description: seed.description,
    coverImageUrl: null,
    acceptsUrgent24h: seed.urgent,
    urgentNotes: seed.urgent ? 'Grúa y asistencia en carretera disponibles ahora.' : null,
    ratingAvg: seed.rating,
    ratingCount: seed.ratingCount,
    slotMinutes: seed.slotMinutes,
    capacity: seed.capacity,
    minNoticeMinutes: seed.minNoticeMinutes,
    bookingHorizonDays: 60,
    services: seed.services.map((service) => toService(seed.id, service)),
    hours: hoursFor(seed.hours),
    promotions: demoPromotionsFor(seed),
  }));
}

function demoPromotionsFor(seed: ShopSeed): ShopListing['promotions'] {
  if (seed.id === 'demo-shop-chamberi') {
    return [
      {
        id: `${seed.id}-promo-aceite`,
        shopId: seed.id,
        title: 'Cambio de aceite -15%',
        description: 'Aceite sintético + filtro. Reserva online y ahorra esta semana.',
        badgeLabel: '-15%',
        discountPercent: 15,
        priceFrom: 59,
        priceTo: 99,
        currency: 'EUR',
        serviceName: 'Cambio de aceite y filtros',
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    ];
  }
  if (seed.urgent) {
    return [
      {
        id: `${seed.id}-promo-itv`,
        shopId: seed.id,
        title: 'Pre-ITV a precio fijo',
        description: 'Revisión de 32 puntos y presupuesto cerrado antes de la ITV.',
        badgeLabel: 'Oferta',
        discountPercent: null,
        priceFrom: 39,
        priceTo: null,
        currency: 'EUR',
        serviceName: 'Pre-ITV',
        startsAt: null,
        endsAt: null,
        isActive: true,
      },
    ];
  }
  return [];
}

export function buildDemoReviews(): Record<string, ShopReview[]> {
  const now = Date.now();
  const result: Record<string, ShopReview[]> = {};

  for (const seed of SEEDS) {
    result[seed.id] = seed.reviews.map((review, index) => ({
      id: `${seed.id}-review-${index}`,
      authorName: review.author,
      rating: review.rating,
      comment: review.comment,
      serviceTag: review.tag ?? null,
      createdAt: new Date(now - review.daysAgo * 86_400_000).toISOString(),
    }));
  }

  return result;
}
