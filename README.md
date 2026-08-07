# DerteApp

Mobile-first PWA and multi-tenant control panel for auto repair shops. Shop owners manage bookings, opening hours and phone activity on their phone; chat is only between each shop owner and the Super Admin. A Super Admin runs the 20–30 Hostinger sites from one master dashboard.

## Stack

- **Backend:** Node.js, Express, PostgreSQL
- **Auth:** Email + password (cuenta Google) for shop owners and Super Admin; optional Google Sign-In; JWT sessions. UI in Spanish.
- **Telephony:** Zadarma REST API (PBX / click-to-call) and Retell AI voice receptionist
- **Calendar:** Google Calendar API (OAuth2 per shop or platform service account)
- **Frontend:** Vanilla JS PWA (manifest + service worker), Hostinger embed snippet

## Quick start

```bash
cp .env.example .env
# Edit .env: DATABASE_URL, JWT_SECRET, SUPER_ADMIN_* credentials

npm install
npm run migrate
npm run seed          # creates the Super Admin
npm run seed -- --demo   # optional: three demo shops with bookings/chats
npm start             # http://localhost:3000
```

### Super Admin

Built-in defaults (overridable via env). Created/updated by `npm run seed` and **ensured on every app boot** (Render-safe, idempotent, bcrypt):

| Variable | Default | Purpose |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | `dertebusiness824@gmail.com` | Sign-in email |
| `SUPER_ADMIN_PASSWORD` | `Marron1*` | Sign-in password (bcrypt-hashed) |
| `SUPER_ADMIN_PHONE` | `+34605686509` | Number shown to shop owners in support chat |

On boot the account is created if missing and the role is kept as `super_admin`. The password is re-applied only when `SUPER_ADMIN_PASSWORD` is set in the environment (or when you run `npm run seed`).

Everyone signs in with **email + password**. Shop owners register with their Google/Gmail email; set `GOOGLE_CLIENT_ID` to show **Continuar con Google**.

### Environment (local + Render)

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL pool / primary connection |
| `DIRECT_URL` | optional | Direct DB URL for migrations (falls back to `DATABASE_URL`) |
| `JWT_SECRET` | yes in production | Session signing key |
| `APP_URL` | yes in production | Public origin (no trailing slash) |
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | optional | Supabase project URL |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | optional | Public anon key |

## Google Calendar

Appointments created from the dashboard, Hostinger form, or Retell webhook can sync to the shop’s Google Calendar.

1. Set OAuth credentials (`GOOGLE_CALENDAR_CLIENT_ID` + `GOOGLE_CALENDAR_CLIENT_SECRET`) and/or a service account (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`) in `.env`.
2. In Google Cloud, enable the **Google Calendar API** and add the redirect URI `{APP_URL}/api/shops/google-calendar/callback`.
3. In the app: **Ajustes → Datos del taller → Google Calendar** — connect with Google (OAuth) or paste a Calendar ID (service account; share the calendar with the SA email).

Each synced booking stores `google_event_id`. Edits update the event; cancellations remove it.

## Retell AI webhook

Point your Retell agent’s webhook at:

```
POST <APP_URL>/api/webhooks/retell
```

Set `RETELL_API_KEY` to an API key that has the webhook badge in the Retell dashboard (Retell signs with the key itself).

When a call ends / is analysed, DerteApp extracts:

- customer name  
- phone number  
- appointment reason / service  
- date and time  

…and creates a **pending** booking on that shop’s calendar. Route a call to a shop by setting the shop’s `retell_agent_id` or `retell_did` (Super Admin → Shop details), or by sending `metadata.shop_id` / `metadata.derte_public_key` from the agent.

Post-call extraction field names can be English or Spanish (`customer_name` / `nombre_cliente`, `appointment_date` / `fecha`, …).

## Hostinger sites

Each shop has a public key and a copy-paste snippet under **Settings → Website booking form**. The snippet:

1. Guards the booking form against times outside opening hours / capacity  
2. Posts confirmed bookings into DerteApp  
3. Sends lightweight pageview analytics  

## Publish (Hostinger VPS / Docker)

The app is a Node + PostgreSQL PWA. Publish it on a VPS (Hostinger KVM works well) with Docker:

```bash
# On the server (or via scripts/publish.sh from your laptop / this agent):
cp .env.production.example .env.production
# Fill APP_URL, CADDY_DOMAIN, JWT_SECRET, POSTGRES_PASSWORD, SUPER_ADMIN_*

docker compose --env-file .env.production --profile proxy up -d --build
docker compose --env-file .env.production exec app npm run seed
```

Point the domain’s A record at the VPS, open ports **80/443**, then open `https://tu-dominio`.

One-shot remote publish (needs SSH access):

```bash
export DEPLOY_HOST=tu-vps-ip
export DEPLOY_USER=root
export DEPLOY_SSH_KEY=~/.ssh/derteapp_deploy
export APP_URL=https://app.tudominio.com
export CADDY_DOMAIN=app.tudominio.com
export JWT_SECRET=… POSTGRES_PASSWORD=… SUPER_ADMIN_EMAIL=… SUPER_ADMIN_PASSWORD=… SUPER_ADMIN_PHONE=…
./scripts/publish.sh
```

After publish, set Retell’s webhook to `https://tu-dominio/api/webhooks/retell` and Zadarma’s to `https://tu-dominio/api/telephony/webhooks/zadarma`.

## Tests

```bash
npm test          # unit + integration tests against PostgreSQL
npx eslint .      # lint
```

Requires a reachable Postgres (default: `postgres://derte:derte@127.0.0.1:5432/derteapp_test`).

## Main routes

| Path | Role |
|---|---|
| `/` | Shop owner home |
| `/appointments`, `/chat/support`, `/schedule` | Day-to-day ops (support chat = Super Admin ↔ owner) |
| `/admin` | Super Admin master dashboard |
| `/admin/inbox` | Support chat across all shops |
| `/api/webhooks/retell` | Retell AI intake |
| `/api/telephony/webhooks/zadarma` | Zadarma PBX events |

Each booking (website form, Google Calendar / Hostinger, or Retell AI) keeps the customer **name**, **email**, **make/model**, **plate**, and a one-tap **Call** button. There is no customer chat.
