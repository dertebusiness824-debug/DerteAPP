import path from 'node:path';
import config from '../config.js';
import { closePool, query, queryOne, transaction } from './index.js';
import { migrate } from './migrate.js';
import { addDays, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import { createShop, hashPassword } from '../services/auth.js';
import { createAppointment } from '../services/appointments.js';
import { getOrCreateSupportThread, postMessage } from '../services/chat.js';

/**
 * Creates (or updates) the Super Admin from the environment / built-in defaults.
 *
 * @param {{ rotatePassword?: boolean }} [options]
 * - `rotatePassword: true` (default for CLI `npm run seed`): re-hash and apply
 *   SUPER_ADMIN_PASSWORD (or the built-in default) every run.
 * - `rotatePassword: false` (boot): create if missing; keep an existing password
 *   unless SUPER_ADMIN_PASSWORD is set explicitly in the environment.
 */
async function ensureSuperAdmin({ rotatePassword = true } = {}) {
  const { phone, email, password, name, passwordFromEnv } = config.superAdmin;
  if (!phone || !password) {
    console.log('[seed] SUPER_ADMIN_PHONE / SUPER_ADMIN_PASSWORD not set — skipping Super Admin creation');
    return null;
  }

  const existing =
    (email ? await queryOne('SELECT * FROM users WHERE lower(email) = lower($1)', [email]) : null) ??
    (await queryOne('SELECT * FROM users WHERE phone = $1', [phone]));

  const shouldRotatePassword = rotatePassword || passwordFromEnv || !existing;

  if (existing) {
    // Re-running the seed re-applies bootstrap identity. Boot only rotates the
    // password when SUPER_ADMIN_PASSWORD is present in the environment.
    const passwordHash = shouldRotatePassword ? await hashPassword(password) : existing.password_hash;
    const updated = await queryOne(
      `UPDATE users
          SET role = 'super_admin',
              email = COALESCE($2, email),
              phone = $3,
              full_name = $4,
              password_hash = $5,
              status = 'active',
              locale = 'es'
        WHERE id = $1
        RETURNING *`,
      [existing.id, email || null, phone, name, passwordHash],
    );
    console.log(
      `[seed] Super Admin actualizado — entra con ${email || phone}` +
        (shouldRotatePassword ? ' (password sincronizada)' : ''),
    );
    return updated;
  }

  const user = await queryOne(
    `INSERT INTO users (phone, email, password_hash, full_name, role, whatsapp_phone, phone_verified_at)
     VALUES ($1, $2, $3, $4, 'super_admin', $1, now()) RETURNING *`,
    [phone, email || null, await hashPassword(password), name],
  );
  console.log(`[seed] created Super Admin — sign in with ${email || phone}`);
  return user;
}

const DEMO_SHOPS = [
  {
    name: 'Derte Auto Centre',
    city: 'Madrid',
    timezone: 'Europe/Madrid',
    owner: {
      full_name: 'Marco Ruiz',
      phone: '+34600111222',
      email: 'marco.demo@gmail.com',
    },
    site_url: 'https://derte-auto-madrid.com',
    services: ['Revisión general', 'Frenos', 'Neumáticos', 'Diagnóstico', 'Aire acondicionado'],
  },
  {
    name: 'Northside Motors',
    city: 'Valencia',
    timezone: 'Europe/Madrid',
    owner: {
      full_name: 'Elena Costa',
      phone: '+34600333444',
      email: 'elena.demo@gmail.com',
    },
    site_url: 'https://northside-motors.com',
    services: ['Cambio de aceite', 'Suspensión', 'Pre-ITV', 'Chapa'],
  },
  {
    name: 'RapidFix Garage',
    city: 'Lisbon',
    timezone: 'Europe/Lisbon',
    owner: {
      full_name: 'Tiago Alves',
      phone: '+351910222333',
      email: 'tiago.demo@gmail.com',
    },
    site_url: 'https://rapidfix-garage.pt',
    services: ['Diagnóstico', 'Embrague', 'Electricidad', 'Neumáticos'],
  },
];

const CUSTOMERS = [
  { name: 'Ana Ferreira', phone: '+34611000001', make: 'Seat', model: 'Leon', year: 2018, plate: '1234ABC' },
  { name: 'Bruno Silva', phone: '+34611000002', make: 'Renault', model: 'Clio', year: 2020, plate: '5678DEF' },
  { name: 'Carla Mendes', phone: '+34611000003', make: 'Toyota', model: 'Corolla', year: 2016, plate: '9012GHI' },
  { name: 'Diego Lopez', phone: '+34611000004', make: 'Volkswagen', model: 'Golf', year: 2019, plate: '3456JKL' },
  { name: 'Eva Ramos', phone: '+34611000005', make: 'Ford', model: 'Focus', year: 2015, plate: '7890MNO' },
];

/** Picks a slot inside opening hours (10:00 / 12:00 / 15:00 / 16:00). */
const slotAt = (shop, dayOffset, hour) => {
  const date = addDays(zonedDateString(new Date(), shop.timezone), dayOffset);
  return utcFromZoned({ ...parseDateOnly(date), hour, minute: 0 }, shop.timezone);
};

async function seedDemo(superAdmin) {
  const password = 'DerteDemo1';
  for (const [index, definition] of DEMO_SHOPS.entries()) {
    const existing = await queryOne('SELECT id FROM shops WHERE name = $1', [definition.name]);
    if (existing) {
      console.log(`[seed] demo shop "${definition.name}" already exists — skipping`);
      continue;
    }

    const { shop, owner } = await transaction(async (client) => {
      const created = await createShop(client, {
        name: definition.name,
        timezone: definition.timezone,
        phone: definition.owner.phone,
        whatsapp_phone: definition.owner.phone,
        city: definition.city,
        site_url: definition.site_url,
        site_domains: [new URL(definition.site_url).host],
      });
      await client.query(`UPDATE shops SET services = $2::jsonb, capacity = $3 WHERE id = $1`, [
        created.id,
        JSON.stringify(definition.services),
        2 + (index % 2),
      ]);

      let user = await client
        .query('SELECT * FROM users WHERE lower(email) = lower($1) OR phone = $2', [
          definition.owner.email,
          definition.owner.phone,
        ])
        .then(({ rows }) => rows[0]);
      if (!user) {
        user = await client
          .query(
            `INSERT INTO users (phone, password_hash, full_name, email, role, whatsapp_phone, phone_verified_at, locale)
             VALUES ($1, $2, $3, $4, 'shop_owner', $1, now(), 'es') RETURNING *`,
            [
              definition.owner.phone,
              await hashPassword(password),
              definition.owner.full_name,
              definition.owner.email,
            ],
          )
          .then(({ rows }) => rows[0]);
      }
      await client.query(
        `INSERT INTO shop_members (shop_id, user_id, role, is_primary) VALUES ($1, $2, 'owner', true)
         ON CONFLICT (shop_id, user_id) DO NOTHING`,
        [created.id, user.id],
      );
      return { shop: created, owner: user };
    });

    const freshShop = await queryOne('SELECT * FROM shops WHERE id = $1', [shop.id]);

    // A believable mix: past completed work and auto-confirmed upcoming jobs.
    const plan = [
      { offset: -6, hour: 10, status: 'completed' },
      { offset: -3, hour: 15, status: 'completed' },
      { offset: 0, hour: 10, status: 'confirmed' },
      { offset: 0, hour: 16, status: 'confirmed' },
      { offset: 1, hour: 12, status: 'confirmed' },
      { offset: 2, hour: 15, status: 'confirmed' },
    ];

    for (const [slotIndex, entry] of plan.entries()) {
      const customer = CUSTOMERS[(slotIndex + index) % CUSTOMERS.length];
      const scheduledAt = slotAt(freshShop, entry.offset, entry.hour);
      const appointment = await createAppointment({
        shop: freshShop,
        input: {
          customer_name: customer.name,
          customer_phone: customer.phone,
          customer_email: `${customer.name.split(' ')[0].toLowerCase()}@example.com`,
          vehicle_make: customer.make,
          vehicle_model: customer.model,
          vehicle_year: customer.year,
          vehicle_plate: customer.plate,
          service_type: definition.services[slotIndex % definition.services.length],
          notes: slotIndex % 2 === 0 ? 'Noise when braking at low speed.' : null,
          scheduled_at: scheduledAt,
          duration_minutes: 60,
          price_estimate: 80 + slotIndex * 25,
          status: 'confirmed',
        },
        source: slotIndex % 3 === 0 ? 'hostinger' : 'phone',
        enforceSchedule: false,
      });

      if (entry.status === 'completed') {
        await query(
          `UPDATE appointments SET status = 'completed', completed_at = scheduled_at + interval '2 hours' WHERE id = $1`,
          [appointment.id],
        );
      }
    }

    // Website traffic and call history so the analytics screens have shape.
    for (let day = 0; day < 21; day += 1) {
      const views = 20 + ((day * 7 + index * 5) % 45);
      for (let visit = 0; visit < views; visit += 1) {
        await query(
          `INSERT INTO site_events (shop_id, event_type, path, device, session_id, created_at)
           VALUES ($1, $2, $3, $4, $5, now() - ($6 || ' days')::interval)`,
          [
            shop.id,
            visit % 9 === 0 ? 'form_view' : 'pageview',
            visit % 4 === 0 ? '/booking' : '/',
            visit % 3 === 0 ? 'desktop' : 'mobile',
            `demo-${day}-${visit}`,
            String(day),
          ],
        );
      }
    }

    for (let call = 0; call < 18; call += 1) {
      const inbound = call % 3 !== 0;
      await query(
        `INSERT INTO call_logs (shop_id, provider, external_id, pbx_call_id, direction, caller_phone, callee_phone,
                                status, disposition, duration_seconds, started_at, ended_at)
         VALUES ($1, 'zadarma', $2, $2, $3, $4, $5, $6, $7, $8,
                 now() - ($9 || ' hours')::interval, now() - ($9 || ' hours')::interval + interval '4 minutes')`,
        [
          shop.id,
          `demo-${shop.id.slice(0, 8)}-${call}`,
          inbound ? 'in' : 'out',
          inbound ? CUSTOMERS[call % CUSTOMERS.length].phone : definition.owner.phone,
          inbound ? definition.owner.phone : CUSTOMERS[call % CUSTOMERS.length].phone,
          call % 5 === 0 ? 'no_answer' : 'completed',
          call % 5 === 0 ? 'no answer' : 'answered',
          call % 5 === 0 ? 0 : 90 + call * 13,
          String(call * 6 + 1),
        ],
      );
    }

    const supportThread = await getOrCreateSupportThread(shop.id);
    await postMessage({
      thread: supportThread,
      senderType: 'shop',
      senderUserId: owner.id,
      senderName: owner.full_name,
      senderPhone: owner.phone,
      body: 'Hi, could you connect our new Zadarma number to this shop?',
    });
    if (superAdmin) {
      await postMessage({
        thread: supportThread,
        senderType: 'admin',
        senderUserId: superAdmin.id,
        senderName: `${superAdmin.full_name} · DerteApp`,
        senderPhone: superAdmin.phone,
        body: 'On it — send me the DID and I will route it to your shop today.',
      });
    }

    console.log(`[seed] demo shop "${definition.name}" ready (owner ${definition.owner.phone} / ${password})`);
  }
}

const isDirectRun = process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`;
if (isDirectRun) {
  try {
    await migrate({ silent: true });
    const superAdmin = await ensureSuperAdmin({ rotatePassword: true });
    if (process.argv.includes('--demo')) {
      await seedDemo(superAdmin);
    } else {
      console.log('[seed] pass --demo to also create three demo shops with bookings, chats and analytics');
    }
    console.log('[seed] done');
  } catch (error) {
    console.error(`[seed] ${error.message}`);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}

export { ensureSuperAdmin, seedDemo };
