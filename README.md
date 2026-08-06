# DerteApp

Mobile-first PWA and multi-tenant control panel for auto repair shops. Shop owners manage bookings, customer chat, opening hours and phone activity on their phone; a Super Admin runs the 20–30 Hostinger sites from one master dashboard.

## Stack

- **Backend:** Node.js, Express, PostgreSQL
- **Auth:** Phone + password (shop owners) or email + password (Super Admin), OTP, JWT sessions
- **Telephony:** Zadarma REST API (PBX / click-to-call) and Retell AI voice receptionist
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

Set in `.env` (applied by `npm run seed`):

| Variable | Purpose |
|---|---|
| `SUPER_ADMIN_EMAIL` | Sign-in email (e.g. `dertebusiness824@gmail.con`) |
| `SUPER_ADMIN_PASSWORD` | Sign-in password |
| `SUPER_ADMIN_PHONE` | Number shown to shop owners in support chat |

Shop owners still sign in with their phone number. On the login screen, switch to **Email** for the Super Admin.

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

## Tests

```bash
npm test          # 140+ unit + integration tests against PostgreSQL
npx eslint .      # lint
```

Requires a reachable Postgres (default: `postgres://derte:derte@127.0.0.1:5432/derteapp_test`).

## Main routes

| Path | Role |
|---|---|
| `/` | Shop owner home |
| `/appointments`, `/chat`, `/schedule` | Day-to-day ops |
| `/admin` | Super Admin master dashboard |
| `/admin/inbox` | Support chat across all shops |
| `/c/:token` | Customer chat (no account) |
| `/api/webhooks/retell` | Retell AI intake |
| `/api/telephony/webhooks/zadarma` | Zadarma PBX events |
