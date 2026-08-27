# DerteApp Talleres — PWA de clientes (marketplace B2C)

Aplicación web progresiva orientada al conductor: busca talleres cerca, compara
precios, reserva cita y pide asistencia urgente 24 h.

Vive en su **propia carpeta aislada** (`client-app/`) con su propio
`package.json`, su build y su despliegue. **No toca ni un archivo de la app B2B
de derteapp**: reutiliza sus variables de entorno de Supabase y se conecta a la
misma base de datos mediante tablas y funciones nuevas con prefijo
`marketplace_`.

```
derteapp/                 ← app B2B existente (intacta)
└── client-app/           ← esta PWA
    ├── src/              ← código de la aplicación
    ├── supabase/         ← SQL aditivo (instalar / desinstalar)
    └── scripts/          ← verificación del SQL contra PostgreSQL
```

## Puesta en marcha

```bash
cd client-app
npm install
npm run dev          # http://127.0.0.1:4173
```

Sin credenciales de Supabase la app arranca en **modo demo** con un catálogo
local: se puede navegar, reservar y pedir urgencias sin backend (los datos van a
`localStorage` y se sincronizan entre pestañas con `BroadcastChannel`).

| Script | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Bundle de producción + service worker |
| `npm run preview` | Sirve el bundle ya construido |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Tests unitarios y de flujo (Vitest + Testing Library) |
| `npm run verify:sql` | Instala y prueba el SQL en un PostgreSQL temporal |

## Configuración

`vite.config.ts` lee los `.env` de la raíz del repositorio (`../.env`,
`../.env.local`) **y** los locales, así que no hace falta duplicar las
credenciales. Acepta los nombres que ya usa derteapp:

```
VITE_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_URL
VITE_SUPABASE_ANON_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_ANON_KEY
```

Solo la URL y la clave anon llegan al navegador; `SUPABASE_SERVICE_ROLE_KEY`
nunca entra en el bundle. Ver `.env.example` para el resto de opciones
(`VITE_MARKETPLACE_MODE`, ciudad por defecto, teléfono de urgencias, ruta base).

Las credenciales se resuelven en este orden:

1. `window.__DERTE_MARKETPLACE_CONFIG__` (inyección del hosting, sin recompilar).
2. Variables de compilación de los `.env`.
3. `GET {VITE_DERTEAPP_API_URL}/api/public/supabase`, el endpoint que ya expone
   el backend B2B.

## Base de datos

El SQL es **aditivo**: crea objetos nuevos con prefijo `marketplace_` y no
modifica ninguna tabla existente.

```bash
# En el SQL editor de Supabase, o con psql:
psql "$DATABASE_URL" -f supabase/marketplace.sql
```

Es idempotente (se puede volver a ejecutar) y reversible:

```bash
psql "$DATABASE_URL" -f supabase/marketplace_uninstall.sql
```

Qué añade:

- **Escaparate** — `marketplace_shop_listings`, `_shop_hours`, `_shop_services`
  se rellenan por *trigger* desde `shops` (y `business_hours` si existe), así
  que publicar un taller en derteapp lo publica en el marketplace.
- **Cliente** — `marketplace_customers`, `_vehicles`, `_favorites`, `_reviews`.
- **Espejo de actividad** — `marketplace_bookings` y `_urgent_requests` reflejan
  el estado de `appointments` y `urgencias`; los cambios que hace el taller en su
  panel llegan al conductor por Supabase Realtime.
- **Escritura controlada** — el cliente nunca escribe en las tablas del B2B: lo
  hace a través de `marketplace_create_booking`,
  `marketplace_create_urgent_request` y `marketplace_cancel_booking`
  (`SECURITY DEFINER`, que validan aforo, antelación y horario antes de insertar
  en `appointments` / `urgencias`).
- **RLS** — el escaparate es público de solo lectura; cada cliente solo ve sus
  datos, sus citas y sus urgencias.

Todo esto se verifica sobre un PostgreSQL real con:

```bash
npm run verify:sql
```

El script levanta un clúster temporal, aplica las migraciones del B2B, instala
`marketplace.sql` dos veces (idempotencia), ejecuta pruebas funcionales de
reserva/urgencia/RLS y comprueba que la desinstalación deja la base como estaba.

## Arquitectura del cliente

```
src/
├── main.tsx / App.tsx        Arranque, rutas y registro del service worker
├── config.ts                 Resolución de credenciales y modo de datos
├── data/                     Capa de datos
│   ├── types.ts              MarketplaceRepository: el contrato único
│   ├── supabaseRepository.ts REST + RPC + Realtime
│   ├── demoRepository.ts     Catálogo local (localStorage + BroadcastChannel)
│   └── mappers.ts, errors.ts
├── providers/                Repositorio, sesión, catálogo, actividad, ubicación, avisos
├── hooks/                    useShopDetail, useAvailability
├── lib/                      Zona horaria, horarios, huecos, distancias, búsqueda, estados
├── components/
│   ├── ui/                   Botón, sheet, badge, estrellas, campos, estados, iconos
│   ├── layout/               AppShell, BottomNav, PageHeader, splash
│   ├── search/               Selector de ubicación, buscador, filtros
│   ├── map/                  ShopMiniMap (SVG, sin dependencias externas)
│   ├── shops/               Tarjeta, horario, servicios, opiniones
│   ├── booking/              Selector de fecha/hora, reserva, asistencia urgente
│   ├── activity/             Tarjeta de cita / urgencia
│   ├── profile/              Alta y edición de vehículos
│   └── auth/                 Panel de acceso global
└── screens/                  Inicio, detalle de taller, mis citas, favoritos, perfil
```

Las pantallas hablan siempre con `MarketplaceRepository`, nunca con Supabase
directamente: por eso el modo demo es un intercambio de implementación y la
interfaz no cambia.

## Pantallas

1. **Inicio** — selector de ciudad/barrio (o GPS), buscador por texto con
   sugerencias, filtros rápidos («abierto ahora», «urgencias 24 h», categorías de
   servicio), mapa con pines y listado de tarjetas. Cada tarjeta muestra nombre,
   estrellas, distancia estimada, estado Abierto/Cerrado y el distintivo
   «Urgencias 24 h».
2. **Detalle del taller** — contacto, dirección, horario semanal, descripción,
   servicios con precios orientativos, opiniones con distribución de estrellas y
   la doble acción fija: **Reservar cita** y **Asistencia urgente**.
3. **Reserva** — servicio → día y hora según disponibilidad real (horario
   publicado cruzado con la ocupación de la agenda del taller) → vehículo y
   contacto → confirmación con referencia. El registro entra en Supabase y
   aparece en el panel del taller.
4. **Asistencia urgente** — motivo, ubicación, teléfono y vehículo; entra en la
   tabla `urgencias` del B2B, con degradación limpia si ese proyecto no la tiene.
5. **Mis citas** — activas e historial, con el estado que marca el taller
   (pendiente / aceptada / en el taller / completada / cancelada), en tiempo real.
6. **Favoritos** y **Perfil** — talleres guardados, datos del conductor y sus
   vehículos registrados.

## Identidad visual

Los tokens de `src/index.css` replican los de `public/css/app.css` del panel
B2B: blancos y grises limpios, azul corporativo `#2563eb` con cyan `#0ea5e9` de
marca, y el rojo `#dc2626` reservado **solo** para urgencias. Tipografía Outfit,
diseño *mobile-first* con un ancho máximo de 30 rem y barra inferior fija.

## PWA

`vite-plugin-pwa` genera manifiesto y service worker (`autoUpdate`). El catálogo
de Supabase se sirve con `NetworkFirst`, así que la última lista de talleres
sigue visible sin cobertura. El bundle está partido por rutas y el cliente de
Supabase va en su propio trozo.

## Despliegue

Es un sitio estático: `npm run build` y se publica `dist/`. Para servirlo en una
subruta, define `VITE_MARKETPLACE_BASE_PATH` (afecta al `base` de Vite, al
`basename` del router y al ámbito del service worker).
