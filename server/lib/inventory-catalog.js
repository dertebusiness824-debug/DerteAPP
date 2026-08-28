/**
 * Starter inventory the Super Admin can push into a shop so the owner does not
 * have to type a hundred rows on day one.
 *
 * Quantities start at 0 on purpose: the preload creates the *catalog* of what
 * the shop stocks, and the owner sets real counts as they go through the shelves.
 */

export const INVENTORY_CATEGORIES = [
  { key: 'tyres', label: 'Neumáticos' },
  { key: 'wheels', label: 'Llantas y ruedas' },
  { key: 'oils', label: 'Aceites y lubricantes' },
  { key: 'filters', label: 'Filtros' },
  { key: 'brakes', label: 'Frenos' },
  { key: 'battery', label: 'Baterías' },
  { key: 'fluids', label: 'Líquidos' },
  { key: 'ignition', label: 'Encendido' },
  { key: 'wipers', label: 'Escobillas' },
  { key: 'consumables', label: 'Consumibles de taller' },
  { key: 'other', label: 'Otros' },
];

export const CATEGORY_KEYS = INVENTORY_CATEGORIES.map((category) => category.key);

export const categoryLabel = (key) =>
  INVENTORY_CATEGORIES.find((category) => category.key === key)?.label ?? 'Otros';

/** `min_quantity` is the reorder point that turns the row red in the list. */
export const INVENTORY_PRESET = [
  // Neumáticos — las medidas más habituales del parque español.
  { name: 'Neumático turismo', category: 'tyres', spec: '175/65 R14', unit: 'ud', min_quantity: 2 },
  { name: 'Neumático turismo', category: 'tyres', spec: '185/65 R15', unit: 'ud', min_quantity: 4 },
  { name: 'Neumático turismo', category: 'tyres', spec: '195/65 R15', unit: 'ud', min_quantity: 4 },
  { name: 'Neumático turismo', category: 'tyres', spec: '205/55 R16', unit: 'ud', min_quantity: 4 },
  { name: 'Neumático turismo', category: 'tyres', spec: '225/45 R17', unit: 'ud', min_quantity: 4 },
  { name: 'Neumático SUV', category: 'tyres', spec: '215/60 R17', unit: 'ud', min_quantity: 2 },
  { name: 'Neumático SUV', category: 'tyres', spec: '225/60 R17', unit: 'ud', min_quantity: 2 },
  { name: 'Neumático furgoneta', category: 'tyres', spec: '215/65 R16C', unit: 'ud', min_quantity: 2 },
  { name: 'Neumático de invierno', category: 'tyres', spec: '205/55 R16 M+S', unit: 'ud', min_quantity: 0 },

  // Llantas y accesorios de rueda.
  { name: 'Llanta de acero', category: 'wheels', spec: '15" 5x112', unit: 'ud', min_quantity: 1 },
  { name: 'Llanta de acero', category: 'wheels', spec: '16" 5x108', unit: 'ud', min_quantity: 1 },
  { name: 'Rueda de repuesto de emergencia', category: 'wheels', spec: '125/80 R16', unit: 'ud', min_quantity: 1 },
  { name: 'Juego de contrapesos adhesivos', category: 'wheels', spec: 'surtido 5-60 g', unit: 'caja', min_quantity: 1 },
  { name: 'Válvulas de neumático', category: 'wheels', spec: 'TR414', unit: 'caja', min_quantity: 1 },
  { name: 'Tornillos de rueda', category: 'wheels', spec: 'M14x1,5 surtido', unit: 'caja', min_quantity: 1 },

  // Aceites.
  { name: 'Aceite de motor', category: 'oils', spec: '5W-30 C3 (VW 507 00)', unit: 'L', min_quantity: 20 },
  { name: 'Aceite de motor', category: 'oils', spec: '5W-40 A3/B4', unit: 'L', min_quantity: 20 },
  { name: 'Aceite de motor', category: 'oils', spec: '0W-20 C5', unit: 'L', min_quantity: 10 },
  { name: 'Aceite de motor', category: 'oils', spec: '10W-40 semisintético', unit: 'L', min_quantity: 10 },
  { name: 'Aceite de caja de cambios manual', category: 'oils', spec: '75W-80 GL-4', unit: 'L', min_quantity: 5 },
  { name: 'Aceite de cambio automático', category: 'oils', spec: 'ATF multivehículo', unit: 'L', min_quantity: 5 },
  { name: 'Grasa de rodamientos', category: 'oils', spec: 'litio EP2', unit: 'kg', min_quantity: 1 },

  // Filtros.
  { name: 'Filtro de aceite', category: 'filters', spec: 'grupo VAG 1.6/2.0 TDI', unit: 'ud', min_quantity: 4 },
  { name: 'Filtro de aceite', category: 'filters', spec: 'PSA 1.5 BlueHDi', unit: 'ud', min_quantity: 4 },
  { name: 'Filtro de aire', category: 'filters', spec: 'turismo genérico', unit: 'ud', min_quantity: 4 },
  { name: 'Filtro de habitáculo', category: 'filters', spec: 'carbón activo', unit: 'ud', min_quantity: 4 },
  { name: 'Filtro de combustible diésel', category: 'filters', spec: 'con separador de agua', unit: 'ud', min_quantity: 3 },

  // Frenos.
  { name: 'Pastillas de freno delanteras', category: 'brakes', spec: 'turismo compacto', unit: 'juego', min_quantity: 3 },
  { name: 'Pastillas de freno traseras', category: 'brakes', spec: 'turismo compacto', unit: 'juego', min_quantity: 2 },
  { name: 'Discos de freno delanteros', category: 'brakes', spec: '280 mm ventilado', unit: 'par', min_quantity: 2 },
  { name: 'Discos de freno traseros', category: 'brakes', spec: '272 mm macizo', unit: 'par', min_quantity: 1 },
  { name: 'Líquido de frenos', category: 'brakes', spec: 'DOT 4', unit: 'L', min_quantity: 5 },
  { name: 'Limpiador de frenos', category: 'brakes', spec: 'spray 500 ml', unit: 'ud', min_quantity: 6 },

  // Baterías.
  { name: 'Batería', category: 'battery', spec: '12V 60Ah 540A', unit: 'ud', min_quantity: 2 },
  { name: 'Batería', category: 'battery', spec: '12V 70Ah 640A', unit: 'ud', min_quantity: 2 },
  { name: 'Batería AGM start-stop', category: 'battery', spec: '12V 70Ah', unit: 'ud', min_quantity: 1 },

  // Líquidos.
  { name: 'Anticongelante', category: 'fluids', spec: 'G12++ concentrado', unit: 'L', min_quantity: 10 },
  { name: 'AdBlue', category: 'fluids', spec: 'garrafa 10 L', unit: 'ud', min_quantity: 2 },
  { name: 'Líquido limpiaparabrisas', category: 'fluids', spec: 'verano/invierno', unit: 'L', min_quantity: 10 },
  { name: 'Líquido de dirección asistida', category: 'fluids', spec: 'ATF/PSF', unit: 'L', min_quantity: 2 },

  // Encendido.
  { name: 'Bujías de encendido', category: 'ignition', spec: 'níquel rosca M14', unit: 'ud', min_quantity: 8 },
  { name: 'Bujías de precalentamiento', category: 'ignition', spec: 'diésel 11V', unit: 'ud', min_quantity: 4 },

  // Escobillas.
  { name: 'Escobillas limpiaparabrisas', category: 'wipers', spec: '600 mm flat', unit: 'ud', min_quantity: 4 },
  { name: 'Escobillas limpiaparabrisas', category: 'wipers', spec: '450 mm flat', unit: 'ud', min_quantity: 4 },
  { name: 'Escobilla trasera', category: 'wipers', spec: '300 mm', unit: 'ud', min_quantity: 2 },

  // Consumibles de taller.
  { name: 'Guantes de nitrilo', category: 'consumables', spec: 'talla L, caja 100', unit: 'caja', min_quantity: 2 },
  { name: 'Papel industrial', category: 'consumables', spec: 'bobina 800 g', unit: 'ud', min_quantity: 4 },
  { name: 'Bridas de plástico', category: 'consumables', spec: 'surtido 100-300 mm', unit: 'caja', min_quantity: 1 },
  { name: 'Fusibles de coche', category: 'consumables', spec: 'surtido mini/estándar', unit: 'caja', min_quantity: 1 },
  { name: 'Aditivo limpiador de inyectores', category: 'consumables', spec: '300 ml', unit: 'ud', min_quantity: 4 },
  { name: 'Desengrasante de motor', category: 'consumables', spec: 'spray 500 ml', unit: 'ud', min_quantity: 4 },
];

/** Preset rows for the chosen categories (all of them when none is given). */
export function presetItems(categories = null) {
  if (!categories?.length) return INVENTORY_PRESET;
  const wanted = new Set(categories);
  return INVENTORY_PRESET.filter((item) => wanted.has(item.category));
}

export const presetSummary = () =>
  INVENTORY_CATEGORIES.map((category) => ({
    ...category,
    count: INVENTORY_PRESET.filter((item) => item.category === category.key).length,
  })).filter((category) => category.count > 0);
