/**
 * Diagnostic assistant for the counter: the owner types what the customer
 * reports and gets back the likely causes, ranked, each with what to check.
 *
 * Two engines, same output shape:
 *   - `ai`    → an external model, when one is configured
 *   - `local` → the rule base below, which is always available and is what the
 *               tests pin down. The response always states which one answered.
 */
import { queryOne } from '../db/index.js';
import { aiConfigured, aiJson, aiModelName } from './ai.js';

export const SEVERITIES = ['alta', 'media', 'baja'];

/**
 * Symptom → probable causes. `keywords` are matched against accent-stripped
 * lowercase text, so "ruído" and "ruido" both hit. `weight` orders the causes
 * inside one symptom; `fuel` narrows a rule to petrol or diesel cars.
 */
export const DIAGNOSTIC_RULES = [
  {
    id: 'no-start-crank',
    keywords: ['no arranca', 'no enciende', 'da vueltas y no arranca', 'cuesta arrancar', 'arranque'],
    causes: [
      {
        title: 'Batería descargada o sulfatada',
        why: 'Es la causa más frecuente cuando el motor gira despacio o no gira.',
        checks: ['Tensión en reposo (≥12,4 V)', 'Caída al arrancar (no bajar de 9,6 V)', 'Bornes y masa del motor'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Motor de arranque o relé de arranque',
        why: 'Si hay tensión correcta y solo se oye un clic, el arranque no está engranando.',
        checks: ['Alimentación en el borne 50', 'Golpe de prueba en la carcasa', 'Consumo del arranque con pinza'],
        severity: 'media',
        weight: 0.7,
      },
      {
        title: 'Falta de presión de combustible',
        why: 'La bomba o el filtro obstruido impiden que llegue caudal al arrancar.',
        checks: ['Cebado de la bomba al dar contacto', 'Presión en rampa', 'Estado del filtro de combustible'],
        severity: 'media',
        weight: 0.6,
      },
      {
        title: 'Inmovilizador o llave no reconocida',
        why: 'El motor gira normal pero no hay inyección ni chispa.',
        checks: ['Testigo de inmovilizador en el cuadro', 'Probar la segunda llave', 'Códigos de la centralita'],
        severity: 'baja',
        weight: 0.35,
      },
    ],
  },
  {
    id: 'no-crank-silent',
    keywords: ['no hace nada', 'no gira el motor', 'clic', 'no da vueltas'],
    causes: [
      {
        title: 'Circuito de arranque abierto',
        why: 'Sin giro y sin ruido, la corriente no llega al motor de arranque.',
        checks: ['Fusibles y relé de arranque', 'Contacto de llave / botón', 'Interruptor de embrague o de punto muerto'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Batería completamente agotada',
        why: 'Con menos de 10 V no se activa ni el relé.',
        checks: ['Tensión en bornes', 'Prueba con batería auxiliar'],
        severity: 'media',
        weight: 0.9,
      },
    ],
  },
  {
    id: 'white-smoke',
    keywords: ['humo blanco', 'vapor blanco', 'humo dulce'],
    causes: [
      {
        title: 'Junta de culata soplada',
        why: 'El refrigerante entra en la cámara y sale como vapor blanco denso.',
        checks: ['Prueba de gases en el vaso de expansión', 'Pérdida de compresión', 'Nivel de refrigerante y aceite emulsionado'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Inyector con caudal excesivo (diésel)',
        why: 'Un inyector abierto produce humo blanco-azulado con olor a gasóleo.',
        checks: ['Prueba de retorno de inyectores', 'Correcciones por cilindro con la máquina'],
        severity: 'alta',
        weight: 0.6,
        fuel: ['diésel'],
      },
      {
        title: 'Condensación normal en frío',
        why: 'Vapor fino que desaparece al calentar; descartar antes de abrir nada.',
        checks: ['Comprobar si desaparece a temperatura de servicio', 'Nivel de refrigerante estable'],
        severity: 'baja',
        weight: 0.4,
      },
    ],
  },
  {
    id: 'blue-smoke',
    keywords: ['humo azul', 'quema aceite', 'consume aceite', 'gasta aceite'],
    causes: [
      {
        title: 'Segmentos o guías de válvula desgastadas',
        why: 'El aceite pasa a la cámara de combustión y se quema.',
        checks: ['Compresión y estanqueidad', 'Prueba de fugas por cárter', 'Consumo entre servicios'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Turbo con retenes dañados',
        why: 'El turbo manda aceite a la admisión, sobre todo al acelerar.',
        checks: ['Aceite en el intercooler y manguitos', 'Juego axial del eje del turbo', 'Retorno de aceite del turbo'],
        severity: 'alta',
        weight: 0.8,
      },
      {
        title: 'Separador de aceite / respiradero obstruido',
        why: 'La sobrepresión del cárter arrastra aceite a la admisión.',
        checks: ['Presión de cárter', 'Estado de la válvula PCV', 'Tapón de llenado con succión anómala'],
        severity: 'media',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'black-smoke',
    keywords: ['humo negro', 'huele a gasoleo', 'mucho humo al acelerar'],
    causes: [
      {
        title: 'Caudalímetro (MAF) sucio o fuera de rango',
        why: 'Una medida de aire baja hace que la centralita inyecte de más.',
        checks: ['Caudal de aire en g/s a plena carga', 'Limpieza del sensor', 'Comparar con valores de referencia'],
        severity: 'media',
        weight: 1,
        fuel: ['diésel'],
      },
      {
        title: 'EGR bloqueada abierta',
        why: 'La recirculación excesiva empobrece el aire y produce hollín.',
        checks: ['Posición real vs consigna de la EGR', 'Depósitos de carbonilla en admisión'],
        severity: 'media',
        weight: 0.85,
      },
      {
        title: 'Filtro de aire saturado',
        why: 'Restricción de aire con la misma inyección: mezcla rica.',
        checks: ['Estado del filtro de aire', 'Depresión en la caja del filtro'],
        severity: 'baja',
        weight: 0.6,
      },
      {
        title: 'Inyectores con exceso de caudal',
        why: 'Pulverización deficiente o retorno alto.',
        checks: ['Prueba de retornos', 'Correcciones por cilindro', 'Estanqueidad de inyectores'],
        severity: 'alta',
        weight: 0.5,
      },
    ],
  },
  {
    id: 'brake-noise',
    keywords: ['chirrido al frenar', 'ruido al frenar', 'frenos', 'rechina al frenar', 'pito al frenar'],
    causes: [
      {
        title: 'Pastillas de freno al límite',
        why: 'El indicador metálico roza el disco y produce el chirrido.',
        checks: ['Espesor de pastillas (mín. 3 mm)', 'Testigo de desgaste', 'Reparto de frenada entre ejes'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Discos rayados o con labio',
        why: 'La superficie irregular hace vibrar la pastilla.',
        checks: ['Espesor y alabeo del disco', 'Labio exterior', 'Estado de la campana'],
        severity: 'media',
        weight: 0.8,
      },
      {
        title: 'Pinza o guías agarrotadas',
        why: 'La pastilla queda rozando y calienta la rueda.',
        checks: ['Retorno del pistón', 'Guías y pasadores engrasados', 'Temperatura comparada entre ruedas'],
        severity: 'alta',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'brake-pedal-soft',
    keywords: ['pedal blando', 'pedal esponjoso', 'pedal se va al fondo', 'frenada larga'],
    causes: [
      {
        title: 'Aire en el circuito hidráulico',
        why: 'El pedal se hunde y recupera al bombear.',
        checks: ['Purga completa del circuito', 'Nivel y estado del líquido', 'Humedad del líquido de frenos'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Fuga en latiguillos o bombín',
        why: 'Pérdida de presión con descenso de nivel.',
        checks: ['Inspección de latiguillos y tuberías', 'Bombín y cilindro principal', 'Huellas de líquido en llantas'],
        severity: 'alta',
        weight: 0.9,
      },
    ],
  },
  {
    id: 'steering-vibration',
    keywords: [
      'vibra el volante',
      'vibra la direccion',
      'vibracion en la direccion',
      'vibracion a cierta velocidad',
      'tiembla el volante',
      'trepidacion',
    ],
    causes: [
      {
        title: 'Equilibrado de ruedas perdido',
        why: 'La vibración aparece en una ventana de velocidad concreta.',
        checks: ['Equilibrado de las cuatro ruedas', 'Contrapesos perdidos', 'Deformaciones en llanta'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Neumático deformado o con bulto',
        why: 'Una carcasa dañada genera vibración constante.',
        checks: ['Inspección visual del flanco', 'Desgaste irregular', 'Presiones en frío'],
        severity: 'alta',
        weight: 0.8,
      },
      {
        title: 'Rótulas, silentblocks o rodamiento con juego',
        why: 'El juego en la dirección amplifica cualquier desequilibrio.',
        checks: ['Juego con el coche en alto', 'Ruido del rodamiento en curva', 'Estado de bieletas y silentblocks'],
        severity: 'media',
        weight: 0.7,
      },
      {
        title: 'Discos con alabeo (si vibra al frenar)',
        why: 'El alabeo se nota en el pedal y el volante durante la frenada.',
        checks: ['Alabeo con reloj comparador', 'Apriete de tornillos de rueda al par'],
        severity: 'media',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'pulls-to-side',
    keywords: [
      'se va a un lado',
      'se va a la derecha',
      'se va a la izquierda',
      'tira a la derecha',
      'tira a la izquierda',
      'se desvia',
      'no va recto',
    ],
    causes: [
      {
        title: 'Alineación de dirección desajustada',
        why: 'Convergencia o caída fuera de tolerancia.',
        checks: ['Alineación de los dos ejes', 'Desgaste de neumáticos por dentro/fuera'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Presiones desiguales',
        why: 'Una rueda baja arrastra el coche hacia ese lado.',
        checks: ['Presiones en frío según etiqueta', 'Pérdidas lentas en válvula o talón'],
        severity: 'baja',
        weight: 0.8,
      },
      {
        title: 'Freno agarrotado en una rueda',
        why: 'Arrastre asimétrico con rueda caliente.',
        checks: ['Temperatura por rueda tras rodar', 'Giro libre en el elevador'],
        severity: 'alta',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'engine-light',
    keywords: ['testigo motor', 'luz de averia', 'check engine', 'testigo naranja', 'anomalia motor'],
    causes: [
      {
        title: 'Leer los códigos antes de sustituir nada',
        why: 'El testigo agrupa cientos de causas; el DTC y sus datos de entorno acotan el trabajo.',
        checks: ['Lectura de DTC con freeze frame', 'Datos en vivo del sistema implicado', 'Historial de averías del vehículo'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Sonda lambda o mezcla fuera de rango',
        why: 'Es uno de los grupos de fallo más habituales con el testigo fijo.',
        checks: ['Correcciones de mezcla a corto y largo plazo', 'Señal de la sonda previa y posterior'],
        severity: 'media',
        weight: 0.7,
      },
      {
        title: 'Fugas de admisión falsas de aire',
        why: 'Aire sin medir descoloca la mezcla y enciende el testigo.',
        checks: ['Prueba de humo en la admisión', 'Manguitos y juntas de colector'],
        severity: 'media',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'misfire',
    keywords: ['tirones', 'fallo de encendido', 'petardea', 'da tirones al acelerar', 'perdida de potencia'],
    causes: [
      {
        title: 'Bujías o bobinas en mal estado',
        why: 'Causa típica de fallo de encendido en gasolina.',
        checks: ['Estado y separación de bujías', 'Resistencia de bobinas', 'Contaje de fallos por cilindro'],
        severity: 'media',
        weight: 1,
        fuel: ['gasolina', 'híbrido', 'gasolina/GLP'],
      },
      {
        title: 'Inyector obstruido',
        why: 'Un cilindro con caudal bajo produce tirones bajo carga.',
        checks: ['Correcciones por cilindro', 'Prueba de caudal y pulverización'],
        severity: 'media',
        weight: 0.85,
      },
      {
        title: 'Filtro de combustible saturado',
        why: 'La presión cae justo al pedir potencia.',
        checks: ['Presión de combustible bajo carga', 'Kilometraje del filtro'],
        severity: 'media',
        weight: 0.7,
      },
      {
        title: 'Turbo o válvula de descarga con fugas',
        why: 'La pérdida de sobrealimentación se percibe como falta de empuje.',
        checks: ['Presión de soplado real vs consigna', 'Manguitos y abrazaderas', 'Actuador de geometría variable'],
        severity: 'alta',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'overheating',
    keywords: ['se calienta', 'sobrecalentamiento', 'temperatura alta', 'aguja de temperatura', 'hierve'],
    causes: [
      {
        title: 'Falta de refrigerante o fuga en circuito',
        why: 'Lo primero es confirmar nivel y estanqueidad.',
        checks: ['Nivel en frío', 'Prueba de presión del circuito', 'Radiador, manguitos y bomba de agua'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Termostato bloqueado cerrado',
        why: 'El motor sube de temperatura sin que el radiador caliente.',
        checks: ['Temperatura de manguitos de entrada y salida', 'Apertura del termostato', 'Lectura del sensor de temperatura'],
        severity: 'alta',
        weight: 0.85,
      },
      {
        title: 'Electroventilador o su mando',
        why: 'Sin ventilador, la temperatura sube en ciudad y baja en autopista.',
        checks: ['Activación del ventilador con la máquina', 'Relé y fusible', 'Sensor de temperatura del refrigerante'],
        severity: 'alta',
        weight: 0.8,
      },
    ],
  },
  {
    id: 'coolant-leak',
    keywords: ['pierde agua', 'fuga de refrigerante', 'mancha verde', 'huele a anticongelante'],
    causes: [
      {
        title: 'Manguitos o abrazaderas',
        why: 'Punto de fuga más habitual y más barato de descartar.',
        checks: ['Prueba de presión en frío', 'Manguitos con grietas o hinchados'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Radiador o botella de expansión fisurados',
        why: 'Fugas finas que solo aparecen con presión y temperatura.',
        checks: ['Inspección con circuito presurizado', 'Restos de refrigerante seco'],
        severity: 'media',
        weight: 0.8,
      },
      {
        title: 'Bomba de agua',
        why: 'El goteo por el retén aparece con el motor en marcha.',
        checks: ['Juego y ruido de la bomba', 'Huellas de fuga bajo la correa'],
        severity: 'alta',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'clutch',
    keywords: ['embrague', 'patina el embrague', 'huele a quemado al subir', 'no entra la marcha'],
    causes: [
      {
        title: 'Disco de embrague desgastado',
        why: 'Revoluciona sin empujar y huele a quemado en cuesta.',
        checks: ['Prueba de patinamiento en 3ª', 'Recorrido del pedal', 'Punto de mordida'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Bombín o circuito hidráulico del embrague',
        why: 'El pedal se queda blando y la marcha entra con dificultad.',
        checks: ['Nivel y fugas del circuito', 'Purga', 'Bombín receptor'],
        severity: 'media',
        weight: 0.8,
      },
      {
        title: 'Cojinete de empuje o collarín',
        why: 'Ruido metálico al pisar el pedal.',
        checks: ['Ruido con pedal pisado y suelto', 'Juego del collarín'],
        severity: 'media',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'dpf',
    keywords: ['filtro de particulas', 'fap', 'dpf', 'regeneracion', 'antipolucion'],
    causes: [
      {
        title: 'Filtro de partículas saturado',
        why: 'Uso urbano corto sin regeneraciones completas.',
        checks: ['Presión diferencial y hollín estimado', 'Historial de regeneraciones', 'Regeneración forzada en carretera'],
        severity: 'alta',
        weight: 1,
        fuel: ['diésel'],
      },
      {
        title: 'Sensor de presión diferencial o sus tomas',
        why: 'Tubos obstruidos dan lecturas falsas de saturación.',
        checks: ['Limpieza de tomas de presión', 'Valor del sensor a ralentí'],
        severity: 'media',
        weight: 0.7,
      },
      {
        title: 'Aditivo o inyección de post-combustión',
        why: 'Sin aditivo (Eolys) no se alcanza la temperatura de quemado.',
        checks: ['Nivel del depósito de aditivo', 'Inyección de 5º inyector si existe'],
        severity: 'media',
        weight: 0.5,
      },
    ],
  },
  {
    id: 'battery-charge',
    keywords: ['se descarga la bateria', 'testigo de bateria', 'alternador', 'luz roja de bateria'],
    causes: [
      {
        title: 'Alternador o regulador',
        why: 'Sin carga, el coche funciona con la batería hasta agotarla.',
        checks: ['Tensión de carga en marcha (13,8–14,6 V)', 'Estado de la correa', 'Diodos y regulador'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Consumo parásito con el coche cerrado',
        why: 'Un módulo que no se duerme descarga la batería en días.',
        checks: ['Medida de consumo en reposo (<50 mA)', 'Retirada de fusibles por circuito'],
        severity: 'media',
        weight: 0.8,
      },
      {
        title: 'Batería al final de su vida',
        why: 'Pierde capacidad aunque la carga sea correcta.',
        checks: ['Prueba de capacidad y CCA', 'Antigüedad de la batería'],
        severity: 'media',
        weight: 0.75,
      },
    ],
  },
  {
    id: 'ac',
    keywords: ['aire acondicionado', 'no enfria', 'clima', 'ac no funciona'],
    causes: [
      {
        title: 'Carga de refrigerante baja por fuga',
        why: 'El circuito es cerrado: si falta gas, hay fuga.',
        checks: ['Presiones de alta y baja', 'Detección con nitrógeno o trazador UV', 'Estado del condensador'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Compresor o su embrague',
        why: 'Sin activación del compresor no baja la temperatura.',
        checks: ['Activación con la máquina de diagnosis', 'Presostato y sensores', 'Ruido del compresor'],
        severity: 'alta',
        weight: 0.75,
      },
      {
        title: 'Filtro de habitáculo y evaporador sucios',
        why: 'Caudal de aire bajo aunque el circuito esté correcto.',
        checks: ['Filtro de polen', 'Limpieza de evaporador', 'Desagüe del climatizador'],
        severity: 'baja',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'suspension-noise',
    keywords: ['ruido en baches', 'golpea la suspension', 'crujido en baches', 'amortiguadores'],
    causes: [
      {
        title: 'Bieletas o silentblocks de estabilizadora',
        why: 'Producen el típico golpeteo seco en baches pequeños.',
        checks: ['Juego con palanca', 'Prueba en plato de suspensión'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Amortiguadores agotados o con fuga',
        why: 'El coche rebota y el neumático se desgasta a parches.',
        checks: ['Prueba de rebote', 'Huellas de aceite en el vástago', 'Copelas y topes'],
        severity: 'media',
        weight: 0.85,
      },
      {
        title: 'Rótulas o brazos de suspensión',
        why: 'Juego que además desajusta la dirección.',
        checks: ['Juego vertical y lateral', 'Estado de los guardapolvos'],
        severity: 'alta',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'rough-idle',
    keywords: ['ralenti inestable', 'se para en ralenti', 'vibra en ralenti', 'se cala'],
    causes: [
      {
        title: 'Cuerpo de mariposa sucio o mal adaptado',
        why: 'El caudal mínimo de aire deja de ser estable.',
        checks: ['Limpieza y adaptación de la mariposa', 'Posición del acelerador en datos en vivo'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Entrada de aire falsa',
        why: 'Aire no medido tras el caudalímetro descuadra la mezcla.',
        checks: ['Prueba de humo', 'Juntas de colector y racores de vacío'],
        severity: 'media',
        weight: 0.85,
      },
      {
        title: 'Válvula EGR sucia',
        why: 'Recirculación en ralentí que ahoga el motor.',
        checks: ['Posición real de EGR', 'Carbonilla en el conducto'],
        severity: 'media',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'gearbox-auto',
    keywords: ['cambio automatico', 'dsg', 'tirones al cambiar', 'no cambia de marcha'],
    causes: [
      {
        title: 'Aceite de cambio degradado o nivel incorrecto',
        why: 'La presión hidráulica cae y aparecen tirones.',
        checks: ['Nivel a temperatura especificada', 'Intervalo de cambio de aceite y filtro'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Mecatrónica o embragues del cambio',
        why: 'Fallos de presión y adaptaciones fuera de rango.',
        checks: ['DTC del módulo de cambio', 'Adaptaciones y presiones en vivo'],
        severity: 'alta',
        weight: 0.8,
      },
    ],
  },
  {
    id: 'timing-belt',
    keywords: ['correa de distribucion', 'distribucion', 'correa dentada', 'chirrido de correa'],
    causes: [
      {
        title: 'Correa de distribución fuera de intervalo',
        why: 'Su rotura destruye el motor: se sustituye por tiempo o kilómetros.',
        checks: ['Kilometraje y fecha del último cambio', 'Estado de correa, tensor y bomba de agua'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Correa auxiliar o tensor (si el chirrido es en frío)',
        why: 'El ruido de correa auxiliar se confunde con la de distribución.',
        checks: ['Inspección de la correa auxiliar', 'Rodamientos de tensor y desviadores'],
        severity: 'media',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'tyres-wear',
    keywords: ['neumaticos', 'desgaste irregular', 'gasta por dentro', 'ruedas gastadas', 'pinchazo'],
    causes: [
      {
        title: 'Alineación y presiones',
        why: 'El desgaste irregular casi siempre viene de aquí.',
        checks: ['Alineación de los dos ejes', 'Presiones según etiqueta y carga', 'Profundidad de dibujo (mín. 1,6 mm)'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Suspensión con juego',
        why: 'Un eje con holgura no mantiene el ángulo de rodadura.',
        checks: ['Rótulas, bieletas y silentblocks', 'Prueba de amortiguación'],
        severity: 'media',
        weight: 0.7,
      },
    ],
  },
  {
    id: 'abs-airbag-light',
    keywords: ['testigo abs', 'testigo airbag', 'esp', 'control de traccion'],
    causes: [
      {
        title: 'Sensor de rueda o su cableado (ABS)',
        why: 'Es la avería más común con el testigo ABS/ESP encendido.',
        checks: ['Señal de los cuatro sensores en vivo', 'Conector y mazo en la mangueta', 'Corona dentada del rodamiento'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Conector bajo asiento o pretensor (airbag)',
        why: 'Los conectores del airbag pierden contacto con el uso.',
        checks: ['DTC del módulo de airbag', 'Conectores bajo asientos', 'Resistencia de pretensores'],
        severity: 'alta',
        weight: 0.8,
      },
    ],
  },
  {
    id: 'oil-pressure',
    keywords: ['presion de aceite', 'testigo de aceite', 'luz roja de aceite', 'ruido metalico en motor'],
    causes: [
      {
        title: 'Nivel de aceite bajo',
        why: 'Antes de cualquier diagnóstico, confirmar nivel y estado.',
        checks: ['Nivel en caliente y en frío', 'Fugas visibles', 'Kilometraje desde el último servicio'],
        severity: 'alta',
        weight: 1,
      },
      {
        title: 'Bomba de aceite o sensor de presión',
        why: 'Presión real baja o lectura falsa: hay que medir con manómetro.',
        checks: ['Presión con manómetro mecánico', 'Sensor y su cableado', 'Filtro y válvula de descarga'],
        severity: 'alta',
        weight: 0.8,
      },
      {
        title: 'Desgaste de casquillos (si hay ruido metálico)',
        why: 'Golpeteo asociado a caída de presión: parar el motor.',
        checks: ['Escucha con estetoscopio', 'Análisis del aceite y del filtro', 'Compresión'],
        severity: 'alta',
        weight: 0.6,
      },
    ],
  },
  {
    id: 'itv',
    keywords: ['itv', 'ha suspendido la itv', 'defecto grave', 'pasar la itv'],
    causes: [
      {
        title: 'Emisiones fuera de límite',
        why: 'Motivo de rechazo más habitual en coches con kilómetros.',
        checks: ['Opacidad / gases con el motor caliente', 'Estado de EGR, FAP y sonda lambda'],
        severity: 'media',
        weight: 1,
      },
      {
        title: 'Frenada desequilibrada',
        why: 'Diferencias entre ruedas del mismo eje.',
        checks: ['Frenómetro por eje', 'Freno de estacionamiento', 'Pinzas y discos'],
        severity: 'alta',
        weight: 0.8,
      },
      {
        title: 'Alumbrado y reglaje de faros',
        why: 'Defecto rápido de corregir antes de volver a pasar.',
        checks: ['Reglaje de faros', 'Todas las luces y catadióptricos'],
        severity: 'baja',
        weight: 0.6,
      },
    ],
  },
];

/** Fallback triage when nothing in the rule base matches the wording. */
const GENERIC_CAUSES = [
  {
    title: 'Lectura de códigos de avería',
    why: 'La descripción no encaja con un patrón conocido: empieza por el diagnóstico electrónico.',
    checks: ['Lectura completa de DTC en todos los módulos', 'Datos en vivo del sistema implicado'],
    severity: 'media',
    weight: 1,
  },
  {
    title: 'Prueba dinámica con el cliente',
    why: 'Reproducir el síntoma acota más que cualquier suposición.',
    checks: ['Ruta con el cliente', 'Condiciones exactas: frío, carga, velocidad', 'Ruidos con ventanillas bajadas'],
    severity: 'baja',
    weight: 0.8,
  },
  {
    title: 'Revisión de mantenimiento básico',
    why: 'Filtros, aceite, bujías y frenos explican una parte enorme de las entradas.',
    checks: ['Historial de servicio', 'Niveles y filtros', 'Desgaste de frenos y neumáticos'],
    severity: 'baja',
    weight: 0.6,
  },
];

export const stripAccents = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/**
 * Grammar words carry no diagnostic meaning and would match almost anything.
 * "no" is deliberately absent: it is the whole difference between "no enciende"
 * (the engine) and "se enciende" (the warning light).
 */
const STOPWORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'es', 'esta', 'este', 'ha', 'hay', 'la', 'las', 'le',
  'lo', 'los', 'me', 'mi', 'mucho', 'muy', 'o', 'para', 'por', 'que', 'se', 'su', 'sus', 'un',
  'una', 'unas', 'unos', 'y', 'ya',
]);

const tokenize = (value) =>
  stripAccents(value)
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/**
 * Same word allowing for Spanish inflection, so the rule base recognises how a
 * customer actually talks: "chirría" for "chirrido", "vibración" for "vibra",
 * "frenar" for "frenos". Short words must match exactly, since a 3-letter stem
 * would collide with half the language.
 */
function sameWord(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  return a.slice(0, 4) === b.slice(0, 4);
}

/**
 * Score of one keyword against the prompt: every meaningful word of the keyword
 * has to appear, in any order. Word order is what made "el volante vibra" miss
 * the keyword "vibra el volante".
 */
function keywordScore(promptTokens, keyword) {
  const words = tokenize(keyword).filter((word) => !STOPWORDS.has(word));
  if (!words.length) return 0;
  const present = words.every((word) => promptTokens.some((token) => sameWord(token, word)));
  if (!present) return 0;
  // A keyword made of several words is far more specific than a single token.
  return words.length > 1 ? 3 : 2;
}

function matchRules(text, { fuel = null } = {}) {
  const promptTokens = tokenize(text);
  const wantFuel = stripAccents(fuel);

  return DIAGNOSTIC_RULES.map((rule) => {
    let score = 0;
    const hits = [];
    for (const keyword of rule.keywords) {
      const keywordPoints = keywordScore(promptTokens, keyword);
      if (!keywordPoints) continue;
      score += keywordPoints;
      hits.push(keyword);
    }
    return { rule, score, hits };
  })
    .filter((row) => row.score > 0)
    .map((row) => {
      // A rule tied to a fuel type is worth more when the vehicle matches.
      const causes = row.rule.causes.filter((cause) => {
        if (!cause.fuel || !wantFuel) return true;
        return cause.fuel.some((value) => wantFuel.includes(stripAccents(value)));
      });
      return { ...row, causes };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Rule-base answer. Deterministic: the same prompt always yields the same list.
 */
export function localDiagnosis({ prompt, vehicle = null, limit = 6 } = {}) {
  const matches = matchRules(prompt, { fuel: vehicle?.fuel });

  const pool = matches.length
    ? matches.flatMap((match) =>
        match.causes.map((cause) => ({ cause, score: match.score * (cause.weight ?? 1), ruleId: match.rule.id })),
      )
    : GENERIC_CAUSES.map((cause) => ({ cause, score: cause.weight ?? 1, ruleId: 'generic' }));

  const ranked = pool.sort((a, b) => b.score - a.score || a.cause.title.localeCompare(b.cause.title)).slice(0, limit);
  const total = ranked.reduce((sum, row) => sum + row.score, 0) || 1;

  return {
    provider: 'local',
    model: null,
    matched: matches.map((match) => match.rule.id),
    causes: ranked.map((row) => ({
      title: row.cause.title,
      why: row.cause.why,
      checks: row.cause.checks,
      severity: row.cause.severity,
      likelihood: Math.max(1, Math.round((row.score / total) * 100)),
      rule_id: row.ruleId,
    })),
  };
}

const AI_SYSTEM = [
  'Eres un jefe de taller español con 25 años de experiencia en mecánica de automoción.',
  'A partir de la descripción del cliente, devuelves las averías más probables.',
  'Responde SOLO con JSON válido: {"causes":[{"title":"","why":"","checks":[""],"severity":"alta|media|baja","likelihood":0}]}.',
  'Máximo 6 causas, ordenadas de más a menos probable, "likelihood" en porcentaje entero.',
  '"checks" son comprobaciones concretas de taller (medidas, pruebas, valores de referencia), 2 o 3 por causa.',
  'Escribe en español de España, con terminología de taller. No inventes datos del vehículo que no se te han dado.',
].join(' ');

function sanitizeAiCauses(data, { limit = 6 } = {}) {
  const list = Array.isArray(data?.causes) ? data.causes : [];
  const causes = list
    .map((item) => {
      const title = String(item?.title ?? '').trim();
      if (!title) return null;
      const severity = SEVERITIES.includes(String(item?.severity ?? '').trim())
        ? String(item.severity).trim()
        : 'media';
      const checks = (Array.isArray(item?.checks) ? item.checks : [])
        .map((check) => String(check ?? '').trim())
        .filter(Boolean)
        .slice(0, 4);
      const likelihood = Number(item?.likelihood);
      return {
        title: title.slice(0, 160),
        why: String(item?.why ?? '').trim().slice(0, 400),
        checks,
        severity,
        likelihood: Number.isFinite(likelihood) ? Math.min(100, Math.max(1, Math.round(likelihood))) : null,
      };
    })
    .filter(Boolean)
    .slice(0, limit);

  if (!causes.length) return null;

  // Fill in missing percentages so the UI always has something to show.
  const missing = causes.filter((cause) => cause.likelihood === null);
  if (missing.length) {
    const fallback = Math.round(100 / causes.length);
    for (const cause of missing) cause.likelihood = fallback;
  }
  return causes;
}

function vehicleLine(vehicle) {
  if (!vehicle) return 'Vehículo: no indicado.';
  const parts = [vehicle.make, vehicle.model, vehicle.version, vehicle.year, vehicle.fuel, vehicle.engine]
    .filter(Boolean)
    .join(' ');
  const km = vehicle.mileage_km ? ` · ${vehicle.mileage_km} km` : '';
  return `Vehículo: ${parts || 'no indicado'}${km}.`;
}

/**
 * Answers a diagnostic query, preferring the configured model and falling back
 * to the rule base whenever it is unavailable or replies with nonsense.
 */
export async function diagnose({ prompt, vehicle = null, limit = 6 } = {}) {
  const local = localDiagnosis({ prompt, vehicle, limit });
  if (!aiConfigured()) return { ...local, fallback_reason: 'ai_not_configured' };

  const result = await aiJson({
    system: AI_SYSTEM,
    user: [
      `Motivo de la consulta: ${prompt}`,
      vehicleLine(vehicle),
      'Devuelve el JSON con las causas probables.',
    ].join('\n'),
  });

  if (!result.ok) return { ...local, fallback_reason: result.error };

  const causes = sanitizeAiCauses(result.data, { limit });
  if (!causes) return { ...local, fallback_reason: 'empty_ai_response' };

  return {
    provider: 'ai',
    model: result.model ?? aiModelName(),
    matched: local.matched,
    causes,
  };
}

export function saveDiagnosticQuery({
  shopId,
  vehicleId = null,
  prompt,
  vehicleLabel = null,
  mileageKm = null,
  result,
  userId = null,
}) {
  return queryOne(
    `INSERT INTO diagnostic_queries
       (shop_id, vehicle_id, prompt, vehicle_label, mileage_km, provider, model, causes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     RETURNING id, created_at`,
    [
      shopId,
      vehicleId,
      prompt,
      vehicleLabel,
      mileageKm,
      result.provider,
      result.model,
      JSON.stringify(result.causes ?? []),
      userId,
    ],
  );
}
