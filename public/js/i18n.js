/**
 * Lightweight i18n for the vanilla PWA (no React).
 * Dictionaries: Spanish (default), English, Catalan, Basque, Galician.
 */
const STORAGE_KEY = 'derte_locale';

export const LOCALES = [
  { code: 'es', name: 'Español', native: 'Español', flag: '🇪🇸' },
  { code: 'en', name: 'English', native: 'English', flag: '🇬🇧' },
  { code: 'ca', name: 'Català', native: 'Català', flag: '🇦🇩' },
  { code: 'eu', name: 'Euskara', native: 'Euskara', flag: '🇪🇸' },
  { code: 'gl', name: 'Galego', native: 'Galego', flag: '🇪🇸' },
];

export const LOCALE_CODES = LOCALES.map((item) => item.code);
export const DEFAULT_LOCALE = 'es';

const dict = {
  es: {
    'nav.home': 'Inicio',
    'nav.appointments': 'Reservas',
    'nav.web': 'Web',
    'nav.chat': 'Soporte',
    'nav.schedule': 'Horario',
    'nav.more': 'Más',
    'nav.admin': 'Resumen',
    'nav.shops': 'Talleres',
    'nav.users': 'Cuentas',
    'nav.inbox': 'Bandeja',
    'nav.aria': 'Principal',
    'web.title': 'Web',
    'web.emptyTitle': 'Sitio no vinculado',
    'web.emptyBody': 'Tu sitio web aún no ha sido vinculado por el administrador.',
    'web.loadError': 'No se pudo cargar la web del taller',
    'web.openExternal': 'Abrir en el navegador',
    'web.iframeTitle': 'Sitio web del taller',
    'web.frameHint': 'Si el panel de Hostinger no se muestra aquí (X-Frame-Options), ábrelo con el botón de arriba.',
    'common.back': 'Atrás',
    'common.save': 'Guardar',
    'common.cancel': 'Cancelar',
    'common.confirm': 'Confirmar',
    'common.search': 'Buscar',
    'common.loading': 'Un momento…',
    'common.active': 'Activo',
    'common.error': 'Algo ha fallado. Comprueba la conexión e inténtalo de nuevo.',
    'common.language': 'Idioma',
    'common.chooseLanguage': 'Idioma de la app',
    'lang.title': 'Idioma',
    'lang.subtitle': 'La interfaz se muestra en este idioma',
    'lang.saved': 'Idioma actualizado',
    'greeting.morning': 'Buenos días',
    'greeting.afternoon': 'Buenas tardes',
    'greeting.evening': 'Buenas noches',
    'home.openNow': 'Abierto ahora',
    'home.closed': 'Cerrado',
    'home.closedToday': 'Cerrado hoy',
    'home.beforeOpening': 'Abre más tarde hoy',
    'home.afterClosing': 'Cerrado por hoy',
    'home.onBreak': 'En descanso',
    'home.dayOff': 'Día libre',
    'home.break': 'descanso',
    'home.schedule': 'Horario',
    'home.jobsToday': 'Trabajos hoy',
    'home.pendingReply': 'Pendientes de respuesta',
    'home.inShop': 'En el taller',
    'home.missedCalls': 'Llamadas perdidas hoy',
    'home.pendingSection': 'Pendientes de tu respuesta',
    'home.todaySection': 'Hoy',
    'home.openToday': 'Abrir',
    'home.loadError': 'No se pudo cargar el panel',
    'home.newBooking': 'Nueva reserva',
    'home.noShopTitle': 'Ningún taller seleccionado',
    'home.noShopAdmin': 'Elige un taller en la pestaña Talleres.',
    'home.noShopOwner': 'Tu cuenta aún no está vinculada a un taller. Escribe al soporte de DerteApp desde la pestaña Soporte.',
    'appointments.title': 'Reservas',
    'appointments.filter.today': 'Hoy',
    'appointments.filter.pending': 'Pendiente',
    'appointments.filter.upcoming': 'Próximas',
    'appointments.filter.completed': 'Hechas',
    'appointments.filter.all': 'Todas',
    'appointments.search': 'Buscar nombre, teléfono, matrícula o referencia',
    'appointments.empty': 'No hay reservas en este filtro',
    'appointments.call': 'Llamar a {name}',
    'appointments.emailContact': 'Enviar Correo',
    'appointments.sendEmail': 'Enviar Correo',
    'appointments.noEmail': 'Esta reserva no tiene email del cliente.',
    'appointments.customerNote': 'Nota del cliente',
    'appointments.internalNote': 'Comentario interno',
    'appointments.addComment': 'Añadir comentario interno',
    'appointments.editComment': 'Editar comentario interno',
    'appointments.commentPlaceholder': 'Notas internas del taller (no se envían al cliente)',
    'appointments.commentHint': 'Solo visible para el equipo del taller.',
    'appointments.saveComment': 'Guardar comentario',
    'appointments.commentSaved': 'Comentario guardado',
    'appointments.confirmedToast': 'Reserva confirmada',
    'appointments.googleNewToast': 'Nueva reserva desde Google Calendar',
    'status.pending': 'Pendiente',
    'status.accepted': 'Confirmada',
    'status.in_progress': 'En curso',
    'status.completed': 'Hecha',
    'status.cancelled': 'Cancelada',
    'status.no_show': 'No presentado',
    'source.hostinger': 'Formulario web',
    'source.dashboard': 'Añadida en DerteApp',
    'source.phone': 'Llamada',
    'source.walk_in': 'Presencial',
    'source.api': 'API',
    'source.retell': 'Recepcionista IA (Retell)',
    'source.google': 'Google Calendar',
    'settings.title': 'Ajustes',
    'settings.account': 'Cuenta',
    'settings.profile': 'Tus datos',
    'settings.profileMeta': 'Nombre, email, número de WhatsApp',
    'settings.password': 'Cambiar contraseña',
    'settings.passwordMeta': 'Cierra sesión en otros dispositivos',
    'settings.shop': 'Datos del taller',
    'settings.shopMeta': 'Nombre, Google Calendar, teléfono, servicios',
    'settings.website': 'Formulario de reservas web',
    'settings.websiteMeta': 'Snippet de Hostinger y clave del sitio',
    'settings.telephony': 'Llamadas y WhatsApp',
    'settings.telephonyMeta': 'Centralita Zadarma e historial de llamadas',
    'settings.team': 'Equipo',
    'settings.teamMeta': 'Personas que pueden usar este taller',
    'settings.hours': 'Horario de apertura',
    'settings.hoursMeta': 'Días, horas y excepciones',
    'settings.support': 'Soporte DerteApp',
    'settings.supportWaMeta': 'WhatsApp o llamada al Super Admin',
    'settings.signOut': 'Cerrar sesión',
    'settings.signOutConfirm': '¿Cerrar sesión?',
    'settings.signOutBody': 'Necesitarás tu correo y contraseña para volver a entrar.',
    'settings.roleAdmin': 'Super Admin',
    'settings.roleOwner': 'Propietario del taller',
    'settings.registeredPhone': 'Tu número registrado',
    'settings.registeredPhoneHint': 'Los clientes y el equipo de DerteApp ven este número arriba en cada chat.',
    'settings.switchShop': 'Cambiar',
    'settings.languageSection': 'Idioma',
    'sa.shopsSection': 'Gestión de Talleres',
    'sa.createShop': 'Crear Nuevo Taller',
    'sa.createShopHint': 'Crea el taller y la cuenta de acceso del propietario en un solo paso.',
    'sa.createShopAuto': 'Crear nuevo taller automático',
    'sa.createShopAutoHint': 'El taller se crea antes de asociar al dueño (recomendado).',
    'sa.shopName': 'Nombre del taller',
    'sa.address': 'Dirección',
    'sa.city': 'Ciudad',
    'sa.shopPhone': 'Teléfono del taller',
    'sa.hostingerUrl': 'URL pública del taller',
    'sa.hostingerPanelUrl': 'URL de la Web (Hostinger / Panel)',
    'sa.hostingerPanelHint': 'Se muestra en la pestaña Web del dueño del taller (iframe o enlace).',
    'sa.hostingerDomains': 'Dominios Hostinger (CORS)',
    'sa.hostingerDomainsHint': 'Uno por línea. Dominios permitidos para el snippet de reservas.',
    'sa.ownerAccess': 'Acceso del propietario',
    'sa.ownerName': 'Nombre del propietario',
    'sa.ownerEmail': 'Email de acceso',
    'sa.ownerPassword': 'Contraseña del taller',
    'sa.passwordHint': 'Mínimo 8 caracteres, con una letra y un número.',
    'sa.createSubmit': 'Crear taller',
    'sa.selectShop': 'Seleccionar Taller Existente',
    'sa.selectShopPlaceholder': 'Elige un taller…',
    'sa.selectShopHint': 'Selecciona un taller para editar sus datos e integraciones.',
    'sa.noOwner': 'Sin propietario vinculado',
    'sa.generalData': 'Datos generales',
    'sa.whatsapp': 'WhatsApp del taller',
    'sa.contactEmail': 'Email de contacto',
    'sa.ownerPasswordSection': 'Contraseña del taller',
    'sa.newOwnerPassword': 'Nueva contraseña del propietario',
    'sa.ownerPasswordHint': 'Déjalo vacío para no cambiarla. Se cierran las sesiones del propietario.',
    'sa.integrations': 'Integraciones',
    'sa.retellKey': 'API Key de Retell AI',
    'sa.retellKeyHint': 'Déjalo vacío para mantener la clave actual. Solo Super Admin.',
    'sa.retellAgent': 'ID del agente Retell',
    'sa.retellDid': 'Número entrante Retell',
    'sa.saveShop': 'Guardar taller',
    'sa.shopSaved': 'Taller actualizado',
    'sa.shopCreated': 'Taller creado',
    'sa.profileSection': 'Perfil y Ajustes del Superadmin',
    'sa.fullName': 'Nombre',
    'sa.email': 'Email',
    'sa.phone': 'Teléfono (soporte global)',
    'sa.phoneHint': 'WhatsApp y llamadas de Soporte de toda la app usan este número (p. ej. +34605686509).',
    'sa.newPassword': 'Nueva contraseña',
    'sa.passwordOptional': 'Opcional — solo si quieres cambiarla',
    'sa.currentPassword': 'Contraseña actual',
    'sa.profileSaved': 'Perfil actualizado',
    'shop.switcherAdmin': 'Cambiar de taller',
    'shop.switcherOwner': 'Tus talleres',
    'shop.none': 'Aún no hay talleres',
    'gcal.title': 'Google Calendar',
    'gcal.synced': 'Agenda sincronizada',
    'gcal.link': 'Vincular Google Calendar',
    'gcal.unlinked': 'Sin vincular',
    'gcal.pendingServer': 'Pendiente de configuración en el servidor',
    'gcal.hint': 'Las citas nuevas, editadas o canceladas se reflejan automáticamente en la agenda del taller.',
    'gcal.connect': 'Conectar Google Calendar',
    'gcal.reconnect': 'Volver a conectar con Google',
    'gcal.calendarId': 'Calendar ID',
    'gcal.syncToggle': 'Sincronizar citas con Google Calendar',
    'gcal.saveId': 'Guardar Calendar ID',
    'gcal.disconnect': 'Desconectar Google Calendar',
    'gcal.disconnectConfirm': '¿Desconectar Google Calendar?',
    'gcal.disconnectBody': 'Las citas nuevas dejarán de sincronizarse. Los eventos ya creados en Google no se borran.',
    'gcal.updated': 'Google Calendar actualizado',
    'gcal.disconnected': 'Google Calendar desconectado',
    'gcal.connectedToast': 'Google Calendar conectado',
    'gcal.errorToast': 'No se pudo conectar Google Calendar',
    'gcal.serverHint': 'Un Super Admin debe configurar las credenciales de Google Calendar en el servidor.',
    'gcal.syncNow': 'Sincronizar ahora',
    'gcal.syncing': 'Sincronizando…',
    'gcal.syncDone': 'Sincronización lista: {created} nuevas, {updated} actualizadas ({fetched} leídas)',
    'gcal.syncFailed': 'No se pudo sincronizar con Google Calendar',
    'gcal.connectedImported': 'Google conectado. Importadas {created} citas ({fetched} leídas).',
    'telephony.zadarmaOn': 'Centralita Zadarma conectada',
    'telephony.zadarmaOff': 'Zadarma no conectado',
    'telephony.zadarmaOnHint': 'Las llamadas con un toque pasan por tu centralita virtual y las entrantes se registran aquí.',
    'telephony.zadarmaOffHint': 'Los botones de llamar y WhatsApp siguen funcionando con tu teléfono. Pide al soporte de DerteApp que conecte un número Zadarma.',
    'telephony.retell': 'Recepcionista IA (Retell)',
    'telephony.retellHint': 'Las llamadas de Retell terminadas se convierten automáticamente en reservas pendientes en tu calendario.',
    'telephony.recent': 'Llamadas recientes',
    'telephony.noCalls': 'Aún no hay llamadas registradas',
    'auth.login': 'Entrar',
    'auth.register': 'Crear cuenta',
    'auth.email': 'Correo electrónico',
    'auth.password': 'Contraseña',
    'install.running': 'Ejecutándose como app instalada',
    'install.cta': 'Instala DerteApp para pantalla completa y arranques más rápidos.',
    'install.button': 'Instalar',
    'install.ios': 'Añade DerteApp a tu pantalla de inicio: toca Compartir y luego Añadir a pantalla de inicio.',
  },
  en: {
    'nav.home': 'Home',
    'nav.appointments': 'Bookings',
    'nav.web': 'Web',
    'nav.chat': 'Support',
    'nav.schedule': 'Hours',
    'nav.more': 'More',
    'nav.admin': 'Overview',
    'nav.shops': 'Shops',
    'nav.users': 'Accounts',
    'nav.inbox': 'Inbox',
    'nav.aria': 'Main',
    'web.title': 'Web',
    'web.emptyTitle': 'Website not linked',
    'web.emptyBody': 'Your website has not been linked by the administrator yet.',
    'web.loadError': 'Could not load the shop website',
    'web.openExternal': 'Open in browser',
    'web.iframeTitle': 'Shop website',
    'web.frameHint': 'If the Hostinger panel does not appear here (X-Frame-Options), open it with the button above.',
    'common.back': 'Back',
    'common.save': 'Save',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.search': 'Search',
    'common.loading': 'One moment…',
    'common.active': 'Active',
    'common.error': 'Something went wrong. Check your connection and try again.',
    'common.language': 'Language',
    'common.chooseLanguage': 'App language',
    'lang.title': 'Language',
    'lang.subtitle': 'The interface is shown in this language',
    'lang.saved': 'Language updated',
    'greeting.morning': 'Good morning',
    'greeting.afternoon': 'Good afternoon',
    'greeting.evening': 'Good evening',
    'home.openNow': 'Open now',
    'home.closed': 'Closed',
    'home.closedToday': 'Closed today',
    'home.beforeOpening': 'Opens later today',
    'home.afterClosing': 'Closed for today',
    'home.onBreak': 'On break',
    'home.dayOff': 'Day off',
    'home.break': 'break',
    'home.schedule': 'Hours',
    'home.jobsToday': 'Jobs today',
    'home.pendingReply': 'Awaiting reply',
    'home.inShop': 'In the shop',
    'home.missedCalls': 'Missed calls today',
    'home.pendingSection': 'Waiting for your reply',
    'home.todaySection': 'Today',
    'home.openToday': 'Open',
    'home.loadError': 'Could not load the dashboard',
    'home.newBooking': 'New booking',
    'home.noShopTitle': 'No shop selected',
    'home.noShopAdmin': 'Pick a shop in the Shops tab.',
    'home.noShopOwner': 'Your account is not linked to a shop yet. Contact DerteApp support from the Support tab.',
    'appointments.title': 'Bookings',
    'appointments.filter.today': 'Today',
    'appointments.filter.pending': 'Pending',
    'appointments.filter.upcoming': 'Upcoming',
    'appointments.filter.completed': 'Done',
    'appointments.filter.all': 'All',
    'appointments.search': 'Search name, phone, plate or reference',
    'appointments.empty': 'No bookings in this filter',
    'appointments.call': 'Call {name}',
    'appointments.emailContact': 'Send email',
    'appointments.sendEmail': 'Send email',
    'appointments.noEmail': 'This booking has no customer email.',
    'appointments.customerNote': 'Customer note',
    'appointments.internalNote': 'Internal comment',
    'appointments.addComment': 'Add internal comment',
    'appointments.editComment': 'Edit internal comment',
    'appointments.commentPlaceholder': 'Internal shop notes (not sent to the customer)',
    'appointments.commentHint': 'Visible only to the shop team.',
    'appointments.saveComment': 'Save comment',
    'appointments.commentSaved': 'Comment saved',
    'appointments.confirmedToast': 'Booking confirmed',
    'appointments.googleNewToast': 'New booking from Google Calendar',
    'status.pending': 'Pending',
    'status.accepted': 'Confirmed',
    'status.in_progress': 'In progress',
    'status.completed': 'Completed',
    'status.cancelled': 'Cancelled',
    'status.no_show': 'No-show',
    'source.hostinger': 'Web form',
    'source.dashboard': 'Added in DerteApp',
    'source.phone': 'Phone call',
    'source.walk_in': 'Walk-in',
    'source.api': 'API',
    'source.retell': 'AI receptionist (Retell)',
    'source.google': 'Google Calendar',
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.profile': 'Your details',
    'settings.profileMeta': 'Name, email, WhatsApp number',
    'settings.password': 'Change password',
    'settings.passwordMeta': 'Signs you out on other devices',
    'settings.shop': 'Shop details',
    'settings.shopMeta': 'Name, Google Calendar, phone, services',
    'settings.website': 'Website booking form',
    'settings.websiteMeta': 'Hostinger snippet and site key',
    'settings.telephony': 'Calls & WhatsApp',
    'settings.telephonyMeta': 'Zadarma PBX and call history',
    'settings.team': 'Team',
    'settings.teamMeta': 'People who can use this shop',
    'settings.hours': 'Opening hours',
    'settings.hoursMeta': 'Days, hours and exceptions',
    'settings.support': 'DerteApp support',
    'settings.supportWaMeta': 'WhatsApp or call the Super Admin',
    'settings.signOut': 'Sign out',
    'settings.signOutConfirm': 'Sign out?',
    'settings.signOutBody': 'You will need your email and password to sign back in.',
    'settings.roleAdmin': 'Super Admin',
    'settings.roleOwner': 'Shop owner',
    'settings.registeredPhone': 'Your registered number',
    'settings.registeredPhoneHint': 'Customers and the DerteApp team see this number at the top of every chat.',
    'settings.switchShop': 'Switch',
    'settings.languageSection': 'Language',
    'shop.switcherAdmin': 'Switch shop',
    'shop.switcherOwner': 'Your shops',
    'shop.none': 'No shops yet',
    'gcal.title': 'Google Calendar',
    'gcal.synced': 'Calendar synced',
    'gcal.link': 'Connect Google Calendar',
    'gcal.unlinked': 'Not connected',
    'gcal.pendingServer': 'Waiting for server configuration',
    'gcal.hint': 'New, edited or cancelled appointments sync automatically to the shop calendar.',
    'gcal.connect': 'Connect Google Calendar',
    'gcal.reconnect': 'Reconnect with Google',
    'gcal.calendarId': 'Calendar ID',
    'gcal.syncToggle': 'Sync appointments with Google Calendar',
    'gcal.saveId': 'Save Calendar ID',
    'gcal.disconnect': 'Disconnect Google Calendar',
    'gcal.disconnectConfirm': 'Disconnect Google Calendar?',
    'gcal.disconnectBody': 'New appointments will stop syncing. Existing Google events are not deleted.',
    'gcal.updated': 'Google Calendar updated',
    'gcal.disconnected': 'Google Calendar disconnected',
    'gcal.connectedToast': 'Google Calendar connected',
    'gcal.errorToast': 'Could not connect Google Calendar',
    'gcal.serverHint': 'A Super Admin must configure Google Calendar credentials on the server.',
    'gcal.syncNow': 'Sync now',
    'gcal.syncing': 'Syncing…',
    'gcal.syncDone': 'Sync done: {created} new, {updated} updated ({fetched} read)',
    'gcal.syncFailed': 'Could not sync with Google Calendar',
    'gcal.connectedImported': 'Google connected. Imported {created} bookings ({fetched} read).',
    'telephony.zadarmaOn': 'Zadarma PBX connected',
    'telephony.zadarmaOff': 'Zadarma not connected',
    'telephony.zadarmaOnHint': 'One-tap calls go through your virtual PBX and inbound calls are logged here.',
    'telephony.zadarmaOffHint': 'Call and WhatsApp buttons still work with your phone. Ask DerteApp support to connect a Zadarma number.',
    'telephony.retell': 'AI receptionist (Retell)',
    'telephony.retellHint': 'Finished Retell calls become pending bookings on your calendar automatically.',
    'telephony.recent': 'Recent calls',
    'telephony.noCalls': 'No calls logged yet',
    'auth.login': 'Sign in',
    'auth.register': 'Create account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'install.running': 'Running as an installed app',
    'install.cta': 'Install DerteApp for fullscreen and faster launches.',
    'install.button': 'Install',
    'install.ios': 'Add DerteApp to your home screen: tap Share, then Add to Home Screen.',
  },
};

/** Regional languages fall back to Spanish for any missing keys. */
dict.ca = {
  ...dict.es,
  'nav.home': 'Inici',
  'nav.appointments': 'Reserves',
  'nav.chat': 'Suport',
  'nav.schedule': 'Horari',
  'nav.more': 'Més',
  'nav.admin': 'Resum',
  'nav.shops': 'Tallers',
  'nav.users': 'Comptes',
  'nav.inbox': 'Safata',
  'common.language': 'Idioma',
  'common.chooseLanguage': 'Idioma de l’app',
  'lang.title': 'Idioma',
  'lang.subtitle': 'La interfície es mostra en aquest idioma',
  'lang.saved': 'Idioma actualitzat',
  'settings.title': 'Ajustos',
  'settings.account': 'Compte',
  'appointments.title': 'Reserves',
  'gcal.title': 'Google Calendar',
  'gcal.connect': 'Connectar Google Calendar',
  'home.openNow': 'Obert ara',
  'home.closed': 'Tancat',
  'greeting.morning': 'Bon dia',
  'greeting.afternoon': 'Bona tarda',
  'greeting.evening': 'Bona nit',
};

dict.eu = {
  ...dict.es,
  'nav.home': 'Hasiera',
  'nav.appointments': 'Erreserbak',
  'nav.chat': 'Laguntza',
  'nav.schedule': 'Ordutegia',
  'nav.more': 'Gehiago',
  'nav.admin': 'Laburpena',
  'nav.shops': 'Tailerrak',
  'nav.users': 'Kontuak',
  'nav.inbox': 'Sarrera',
  'common.language': 'Hizkuntza',
  'common.chooseLanguage': 'Aplikazioaren hizkuntza',
  'lang.title': 'Hizkuntza',
  'lang.subtitle': 'Interfazea hizkuntza honetan erakusten da',
  'lang.saved': 'Hizkuntza eguneratuta',
  'settings.title': 'Ezarpenak',
  'settings.account': 'Kontua',
  'appointments.title': 'Erreserbak',
  'gcal.title': 'Google Calendar',
  'gcal.connect': 'Konektatu Google Calendar',
  'home.openNow': 'Irekita orain',
  'home.closed': 'Itxita',
  'greeting.morning': 'Egun on',
  'greeting.afternoon': 'Arratsalde on',
  'greeting.evening': 'Gabon',
};

dict.gl = {
  ...dict.es,
  'nav.home': 'Inicio',
  'nav.appointments': 'Reservas',
  'nav.chat': 'Soporte',
  'nav.schedule': 'Horario',
  'nav.more': 'Máis',
  'nav.admin': 'Resumo',
  'nav.shops': 'Talleres',
  'nav.users': 'Contas',
  'nav.inbox': 'Bandexa',
  'common.language': 'Idioma',
  'common.chooseLanguage': 'Idioma da app',
  'lang.title': 'Idioma',
  'lang.subtitle': 'A interface móstrase neste idioma',
  'lang.saved': 'Idioma actualizado',
  'settings.title': 'Axustes',
  'settings.account': 'Conta',
  'appointments.title': 'Reservas',
  'gcal.title': 'Google Calendar',
  'gcal.connect': 'Conectar Google Calendar',
  'home.openNow': 'Aberto agora',
  'home.closed': 'Pechado',
  'greeting.morning': 'Bos días',
  'greeting.afternoon': 'Boas tardes',
  'greeting.evening': 'Boas noites',
};

let current = DEFAULT_LOCALE;
const listeners = new Set();

function readStored() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Ignore private-mode failures.
  }
}

export function normalizeLocale(code) {
  const raw = String(code ?? '')
    .trim()
    .toLowerCase()
    .slice(0, 8);
  if (LOCALE_CODES.includes(raw)) return raw;
  const base = raw.split('-')[0];
  return LOCALE_CODES.includes(base) ? base : DEFAULT_LOCALE;
}

export function getLocale() {
  return current;
}

export function getLocaleMeta(code = current) {
  return LOCALES.find((item) => item.code === code) ?? LOCALES[0];
}

/** Translate a key. Supports `{name}` placeholders. Falls back to Spanish then the key. */
export function t(key, vars = {}) {
  const table = dict[current] ?? dict[DEFAULT_LOCALE];
  let text = table[key] ?? dict[DEFAULT_LOCALE][key] ?? key;
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, String(value ?? ''));
  }
  return text;
}

export function subscribeLocale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitLocale() {
  for (const listener of listeners) listener(current);
}

/**
 * Sets the active locale, persists to localStorage, and notifies subscribers.
 * Does not hit the API — callers persist to the user profile when authenticated.
 */
export function setLocale(code, { silent = false } = {}) {
  const next = normalizeLocale(code);
  if (next === current && !silent) return current;
  current = next;
  writeStored(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  if (!silent) emitLocale();
  return current;
}

/** Resolve initial locale: stored → user → browser → Spanish. */
export function initLocale(userLocale = null) {
  const stored = readStored();
  const browser = typeof navigator !== 'undefined' ? navigator.language : null;
  const chosen = normalizeLocale(userLocale || stored || browser || DEFAULT_LOCALE);
  current = chosen;
  writeStored(chosen);
  if (typeof document !== 'undefined') document.documentElement.lang = chosen;
  return current;
}

export function languageSelectHtml({ id = 'lang-select', className = 'input lang-select' } = {}) {
  return `
    <label class="sr-only" for="${id}">${t('common.chooseLanguage')}</label>
    <select id="${id}" class="${className}" data-lang-select aria-label="${t('common.chooseLanguage')}">
      ${LOCALES.map(
        (item) =>
          `<option value="${item.code}" ${item.code === current ? 'selected' : ''}>${item.flag} ${item.native}</option>`,
      ).join('')}
    </select>`;
}

export function languageChipHtml() {
  const meta = getLocaleMeta();
  return `
    <button type="button" class="btn btn--small btn--soft header__lang" data-lang-menu aria-label="${t('common.language')}">
      <span aria-hidden="true">${meta.flag}</span>
      <span class="header__lang-code">${meta.code.toUpperCase()}</span>
    </button>`;
}
