import { query, queryOne } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { countryCodeOf, formatPhone } from '../lib/phone.js';
import { formatInZone, parseDateOnly, utcFromZoned, zonedDateString } from '../lib/time.js';
import {
  createAppointment,
  getAppointment,
  serializeAppointment,
  updateAppointment,
} from './appointments.js';
import { checkBookable, getAvailability } from './schedule.js';
import { extractBooking, resolveShopForCall } from './retell.js';

/**
 * Turns a finished Retell AI call into a booking on the shop's calendar.
 *
 * Guiding rule: never lose a lead. If the agent could not capture a usable
 * time, or asked for a slot the shop is closed for, the booking is still
 * created as `pending` with a note explaining what to confirm - a shop owner
 * would rather call back than never hear about the customer.
 */

const externalRef = (callId) => `retell:${callId}`;

/** First bookable slot from `from`, so a vague call still lands somewhere sane. */
async function firstAvailableSlot(shop, { from = null, now = new Date() } = {}) {
  const startDate = from ?? zonedDateString(now, shop.timezone);
  const availability = await getAvailability({ shop, from: startDate, days: 14, now });
  for (const day of availability.days) {
    const slot = day.slots.find((entry) => entry.available);
    if (slot) return new Date(slot.start_at);
  }
  return null;
}

/** Records the call itself so it shows up in the shop's call history. */
async function upsertCallLog({ shop, call, booking, appointmentId = null }) {
  if (!call.call_id) return null;

  const outbound = call.direction === 'outbound';
  const started = call.start_timestamp ? new Date(call.start_timestamp) : new Date();
  const ended = call.end_timestamp ? new Date(call.end_timestamp) : null;
  const durationSeconds = Math.max(
    Math.round((call.duration_ms ?? (ended && call.start_timestamp ? ended - started : 0)) / 1000),
    0,
  );
  const answered = call.call_status === 'ended' || Boolean(call.end_timestamp);

  const row = await queryOne(
    `INSERT INTO call_logs
       (shop_id, appointment_id, provider, external_id, pbx_call_id, direction, caller_phone, callee_phone,
        status, disposition, duration_seconds, recording_url, started_at, ended_at, raw)
     VALUES ($1, $2, 'retell', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (provider, external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET shop_id = COALESCE(EXCLUDED.shop_id, call_logs.shop_id),
            appointment_id = COALESCE(EXCLUDED.appointment_id, call_logs.appointment_id),
            status = EXCLUDED.status,
            disposition = COALESCE(EXCLUDED.disposition, call_logs.disposition),
            duration_seconds = GREATEST(EXCLUDED.duration_seconds, call_logs.duration_seconds),
            recording_url = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
            ended_at = COALESCE(EXCLUDED.ended_at, call_logs.ended_at),
            raw = call_logs.raw || EXCLUDED.raw
     RETURNING *`,
    [
      shop?.id ?? null,
      appointmentId,
      call.call_id,
      outbound ? 'out' : 'in',
      booking.caller_number ?? call.from_number ?? null,
      call.to_number ?? null,
      answered ? 'completed' : 'started',
      call.disconnection_reason ?? null,
      durationSeconds,
      call.recording_url ?? null,
      started.toISOString(),
      ended?.toISOString() ?? null,
      { retell: { event: call._event ?? null, agent_id: call.agent_id ?? null, summary: booking.summary ?? null } },
    ],
  );
  return row;
}

/** Human-readable notes: what the AI heard, plus anything that needs checking. */
function composeNotes({ booking, warnings }) {
  const parts = [];
  if (warnings.length) parts.push(warnings.map((warning) => `! ${warning}`).join('\n'));
  if (booking.notes) parts.push(booking.notes);
  if (booking.summary) parts.push(`AI receptionist summary: ${booking.summary}`);
  if (booking.time?.raw && booking.time.precision !== 'datetime') {
    parts.push(`Caller said: "${booking.time.raw}"`);
  }
  return parts.join('\n\n').slice(0, 2000) || null;
}

/**
 * Processes one Retell webhook.
 * Returns a small result object; the route turns it into the HTTP response.
 */
export async function ingestRetellCall({ event, call, now = new Date() }) {
  if (!call || typeof call !== 'object') return { ok: false, ignored: true, reason: 'missing_call' };
  if (!call.call_id) return { ok: false, ignored: true, reason: 'missing_call_id' };

  const { shop, matched_by: matchedBy } = await resolveShopForCall(call);
  const booking = extractBooking(call, {
    timezone: shop?.timezone ?? 'UTC',
    now,
    defaultCountryCode: shop?.country_code || countryCodeOf(shop?.phone),
  });
  const tagged = { ...call, _event: event };

  // A call that started tells us nothing bookable yet; just open the log entry.
  if (event === 'call_started') {
    await upsertCallLog({ shop, call: tagged, booking });
    return { ok: true, stage: 'call_started', shop_id: shop?.id ?? null, appointment: null };
  }

  if (!shop) {
    await upsertCallLog({ shop: null, call: tagged, booking });
    return {
      ok: true,
      ignored: true,
      reason: 'shop_not_matched',
      hint: 'Set the shop\'s retell_agent_id or retell_did, or send metadata.shop_id from the Retell agent.',
    };
  }

  if (!booking.phone) {
    await upsertCallLog({ shop, call: tagged, booking });
    return { ok: true, ignored: true, reason: 'missing_phone', shop_id: shop.id };
  }

  const existing = await queryOne('SELECT * FROM appointments WHERE external_ref = $1', [externalRef(call.call_id)]);
  const warnings = [];

  // --- when ---
  let scheduledAt = booking.time.at;
  if (!scheduledAt && booking.time.precision === 'date') {
    const parts = booking.time.date_parts;
    scheduledAt = await firstAvailableSlot(shop, {
      from: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
      now,
    });
    warnings.push('The caller gave a day but no time — this slot was picked automatically. Confirm it.');
  }
  if (!scheduledAt) {
    scheduledAt = await firstAvailableSlot(shop, { now });
    warnings.push('The AI receptionist did not capture a date and time — confirm with the customer.');
  }
  if (!scheduledAt) {
    // No open slot in the next two weeks: park it at the raw time or now, so
    // the request is still visible in the calendar.
    scheduledAt = utcFromZoned(
      { ...parseDateOnly(zonedDateString(now, shop.timezone)), hour: 9, minute: 0 },
      shop.timezone,
    );
    warnings.push('No free slot was found in the next two weeks — reschedule manually.');
  }

  if (booking.time.precision === 'datetime') {
    const check = await checkBookable({ shop, scheduledAt, durationMinutes: shop.slot_minutes, now });
    if (!check.ok) warnings.push(`Requested time is not normally bookable (${check.message}) — confirm with the customer.`);
  }

  const vehicleParts = String(booking.vehicle ?? '').trim().split(/\s+/).filter(Boolean);
  const input = {
    customer_name: booking.name ?? `Caller ${formatPhone(booking.phone)}`,
    customer_phone: booking.phone,
    customer_email: booking.email ?? null,
    vehicle_make: vehicleParts[0] ?? null,
    vehicle_model: vehicleParts.slice(1).join(' ') || null,
    vehicle_plate: booking.plate ?? null,
    service_type: booking.reason ?? null,
    notes: composeNotes({ booking, warnings }),
    scheduled_at: scheduledAt,
    duration_minutes: shop.slot_minutes,
    status: 'confirmed',
  };

  // Retell sends call_ended and then call_analyzed for the same call: the
  // second one usually carries the extracted fields, so refresh rather than
  // duplicate. Only untouched auto-confirmed bookings are updated.
  if (existing) {
    if (['pending', 'accepted', 'confirmed'].includes(existing.status)) {
      const patch = {};
      if (booking.name && existing.customer_name !== booking.name) patch.customer_name = booking.name;
      if (booking.reason && !existing.service_type) patch.service_type = booking.reason;
      if (booking.time.precision === 'datetime' && new Date(existing.scheduled_at).getTime() !== scheduledAt.getTime()) {
        patch.scheduled_at = scheduledAt;
      }
      if (input.notes && input.notes !== existing.notes) patch.notes = input.notes;
      if (Object.keys(patch).length > 0) {
        await updateAppointment({ shop, appointmentId: existing.id, patch });
      }
    }
    await upsertCallLog({ shop, call: tagged, booking, appointmentId: existing.id });
    const refreshed = await getAppointment(shop.id, existing.id);
    return {
      ok: true,
      stage: event,
      updated: true,
      shop_id: shop.id,
      matched_by: matchedBy,
      appointment: serializeAppointment(refreshed, { timezone: shop.timezone }),
    };
  }

  const appointment = await createAppointment({
    shop,
    input,
    source: 'retell',
    // The shop should hear about the lead even if the requested time is odd.
    enforceSchedule: false,
    externalRef: externalRef(call.call_id),
    // Replaced by the AI-specific alert below.
    notify: false,
  });

  await upsertCallLog({ shop, call: tagged, booking, appointmentId: appointment.id });

  await query(
    `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
     SELECT m.user_id, $1, 'retell_booking', $2, $3, $4 FROM shop_members m WHERE m.shop_id = $1`,
    [
      shop.id,
      'AI receptionist took a booking',
      `${appointment.customer_name} · ${formatInZone(new Date(appointment.scheduled_at), shop.timezone, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })}${warnings.length ? ' · needs review' : ''}`,
      `/appointments/${appointment.id}`,
    ],
  );

  hub.publish(channels.shop(shop.id), {
    type: 'retell_booking',
    shop_id: shop.id,
    appointment: serializeAppointment(appointment, { timezone: shop.timezone }),
  });

  return {
    ok: true,
    stage: event,
    created: true,
    shop_id: shop.id,
    matched_by: matchedBy,
    needs_review: warnings.length > 0,
    warnings,
    appointment: serializeAppointment(appointment, { timezone: shop.timezone }),
  };
}

export default { ingestRetellCall };
