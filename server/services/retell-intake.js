import { query, queryOne } from '../db/index.js';
import { channels, hub } from '../lib/events.js';
import { countryCodeOf } from '../lib/phone.js';
import { formatInZone } from '../lib/time.js';
import {
  createAppointment,
  getAppointment,
  serializeAppointment,
  updateAppointment,
} from './appointments.js';
import { checkBookable } from './schedule.js';
import {
  bagHasExtractionFields,
  extractBooking,
  mapUrgenciaFieldsFromAnalysis,
  mergeCustomAnalysisData,
  resolveShopForCall,
} from './retell.js';
import { serializeUrgencia, syncUrgenciaToSupabase, upsertUrgencia } from './urgencias.js';
import { notifyNuevaUrgencia } from './web-push.js';
import {
  evaluateUrgenciaGates,
  extractCallAnalyzedFields,
  extractRawVehicle,
  getPostCallCustomData,
  hasValidVehicle,
} from './retell-gates.js';

/**
 * Turns a finished Retell AI call into a booking on the shop's calendar —
 * or into Urgencias when the call is urgent / incomplete / placeholder.
 */

/** Minimum talk time before we create Urgencias / reservas (40s). */
export const MIN_CALL_DURATION_MS = 40_000;

/** Disconnect reasons that mean the caller never reached a real conversation. */
const MISSED_DISCONNECT_REASONS = new Set([
  'dial_busy',
  'dial_no_answer',
  'dial_failed',
  'voicemail',
  'voicemail_reached',
  'marked_as_voicemail',
  'ivr_reach_end',
]);

const externalRef = (callId) => `retell:${callId}`;

/** Duration in ms from `duration_ms` or start/end timestamps. */
export function resolveCallDurationMs(call = {}) {
  const raw = Number(call.duration_ms);
  if (Number.isFinite(raw) && raw >= 0) return raw;

  const start = Number(call.start_timestamp);
  const end = Number(call.end_timestamp);
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
    return end - start;
  }
  return null;
}

/** Duration in seconds (0 when unknown) — matches Retell webhook gate. */
export function resolveCallDurationSec(call = {}) {
  const durationMs =
    Number(call.duration_ms) ||
    (Number(call.end_timestamp) && Number(call.start_timestamp)
      ? Number(call.end_timestamp) - Number(call.start_timestamp)
      : 0) ||
    0;
  const ms = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : resolveCallDurationMs(call) || 0;
  return ms / 1000;
}

/**
 * True when the call is a missed / hang-up / too-short interaction that must
 * not create Urgencias (or reservas). Caller should still ACK HTTP 200.
 * Duration gate: durationSec <= 40 → skip.
 */
export function isMissedOrTooShortCall(call = {}) {
  const durationMs = resolveCallDurationMs(call);
  const durationSec = resolveCallDurationSec(call);
  const disconnect = String(call.disconnection_reason ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const callSuccessful = call.call_analysis?.call_successful;

  if (MISSED_DISCONNECT_REASONS.has(disconnect)) {
    return { skip: true, durationMs, durationSec, reason: `disconnection:${disconnect}` };
  }

  if (durationSec <= 40) {
    return { skip: true, durationMs, durationSec, reason: 'short_duration' };
  }

  // Hang-up with almost no talk time (or unknown duration).
  if (disconnect === 'user_hangup' && durationSec <= 40) {
    return { skip: true, durationMs, durationSec, reason: 'user_hangup_short' };
  }

  // Agent marked the call unsuccessful and there was no meaningful interaction.
  if (callSuccessful === false) {
    const transcript = String(call.transcript ?? '').trim();
    const noInteraction = !transcript || transcript.length < 40 || durationSec <= 40;
    if (noInteraction) {
      return { skip: true, durationMs, durationSec, reason: 'call_unsuccessful' };
    }
  }

  return { skip: false, durationMs, durationSec, reason: null };
}

/** Records the call itself so it shows up in the shop's call history (call_logs). */
async function upsertCallLog({ shop, call, booking, appointmentId = null, forceCompleted = false } = {}) {
  if (!call.call_id) return null;

  const outbound = call.direction === 'outbound';
  const started = call.start_timestamp ? new Date(call.start_timestamp) : new Date();
  const ended = call.end_timestamp ? new Date(call.end_timestamp) : forceCompleted ? new Date() : null;
  const durationSeconds = Math.max(
    Math.round((call.duration_ms ?? (ended && call.start_timestamp ? ended - started : 0)) / 1000),
    0,
  );
  const eventName = call._event || '';
  const answered =
    forceCompleted ||
    eventName === 'call_ended' ||
    eventName === 'call_analyzed' ||
    call.call_status === 'ended' ||
    Boolean(call.end_timestamp);

  // Prefer analysis phone, then from_number / user_number / caller_number.
  const callerPhone =
    booking?.phone ||
    booking?.caller_number ||
    call.from_number ||
    call.user_number ||
    call.caller_number ||
    call.customer_number ||
    null;
  const calleePhone = call.to_number || null;

  const row = await queryOne(
    `INSERT INTO call_logs
       (shop_id, appointment_id, provider, external_id, pbx_call_id, direction, caller_phone, callee_phone,
        status, disposition, duration_seconds, recording_url, started_at, ended_at, raw)
     VALUES ($1, $2, 'retell', $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (provider, external_id) WHERE external_id IS NOT NULL DO UPDATE
        SET shop_id = COALESCE(EXCLUDED.shop_id, call_logs.shop_id),
            appointment_id = COALESCE(EXCLUDED.appointment_id, call_logs.appointment_id),
            status = CASE
              WHEN call_logs.status IN ('completed', 'no_answer', 'busy', 'failed', 'cancelled')
                   AND EXCLUDED.status IN ('started', 'ringing', 'answered')
              THEN call_logs.status
              ELSE EXCLUDED.status
            END,
            disposition = COALESCE(EXCLUDED.disposition, call_logs.disposition),
            duration_seconds = GREATEST(EXCLUDED.duration_seconds, call_logs.duration_seconds),
            recording_url = COALESCE(EXCLUDED.recording_url, call_logs.recording_url),
            ended_at = COALESCE(EXCLUDED.ended_at, call_logs.ended_at),
            caller_phone = COALESCE(EXCLUDED.caller_phone, call_logs.caller_phone),
            callee_phone = COALESCE(EXCLUDED.callee_phone, call_logs.callee_phone),
            raw = call_logs.raw || EXCLUDED.raw
     RETURNING *`,
    [
      shop?.id ?? null,
      appointmentId,
      call.call_id,
      outbound ? 'out' : 'in',
      callerPhone,
      calleePhone,
      answered ? 'completed' : 'started',
      call.disconnection_reason ?? null,
      durationSeconds,
      call.recording_url ?? null,
      started.toISOString(),
      ended?.toISOString() ?? null,
      {
        retell: {
          event: call._event ?? null,
          agent_id: call.agent_id ?? null,
          summary: booking?.summary ?? null,
          transcript: booking?.transcript ?? null,
          is_urgent: booking?.is_urgent ?? false,
          custom_analysis_data: booking?.custom_analysis_data ?? null,
          retell_llm_dynamic_variables: booking?.retell_llm_dynamic_variables ?? null,
        },
      },
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

/** True for placeholder names like "Caller +34655…" that must never become reservas. */
export function isPlaceholderCallerName(name) {
  const text = String(name ?? '').trim();
  if (!text) return true;
  if (/^caller\s*\+?\s*34/i.test(text)) return true;
  if (/^caller\s*\+/i.test(text)) return true;
  if (/^sin nombre$/i.test(text)) return true;
  return false;
}

/** True when Retell attached real post-call / tool extraction (not input dynamic vars). */
export function hasAnalysisPayload(call = {}, booking = {}) {
  // call_ended does NOT include call_analysis per Retell docs — only call_analyzed does.
  // retell_llm_dynamic_variables are INPUT seeds and must not unlock Urgencias early.
  const bags = [
    call.call_analysis?.custom_analysis_data,
    call.custom_analysis_data,
    // booking.custom_analysis_data may include merged LLM input vars — only trust
    // it when the call itself also carried a real analysis/args/collected bag.
    call.args,
    booking.args,
    call.collected_dynamic_variables,
    booking.collected_dynamic_variables,
  ];
  for (const bag of bags) {
    if (bagHasExtractionFields(bag)) return true;
  }
  return false;
}

/**
 * A confirmed reserva requires real analyzed customer data + a captured slot
 * + a valid vehicle + call duration > 40s.
 * Anything incomplete (or urgent) goes to Urgencias instead.
 *
 * @param {object} [opts]
 * @param {number|null} [opts.durationSec] Call duration in seconds (required for true).
 * @param {string|null} [opts.vehicle] Raw vehicle from analysis (falls back to booking fields).
 */
export function canCreateConfirmedReserva(booking = {}, { durationSec = null, vehicle = null } = {}) {
  if (booking.is_urgent) return false;
  if (isPlaceholderCallerName(booking.name)) return false;
  if (!String(booking.name ?? '').trim()) return false;
  if (!String(booking.reason ?? '').trim()) return false;
  if (booking.time?.precision !== 'datetime') return false;

  const resolvedVehicle =
    vehicle ??
    booking.vehicle ??
    booking.vehicle_model ??
    booking.vehicle_make ??
    null;
  if (!hasValidVehicle(resolvedVehicle)) return false;

  const duration = durationSec != null ? Number(durationSec) : null;
  if (duration == null || !Number.isFinite(duration) || !(duration > 40)) return false;

  return true;
}

/**
 * Processes one Retell webhook.
 * Returns a small result object; the route turns it into the HTTP response.
 *
 * @param {object|null} [analysisOverrides] Mapped {nombre,vehiculo,matricula,motivo}
 *   from the webhook's exhaustive getCustomField lookup (call_analyzed only).
 */
export async function ingestRetellCall({
  event,
  call,
  body = null,
  now = new Date(),
  analysisOverrides = null,
} = {}) {
  if (!call || typeof call !== 'object') return { ok: false, ignored: true, reason: 'missing_call' };
  if (!call.call_id) return { ok: false, ignored: true, reason: 'missing_call_id' };

  const { shop, matched_by: matchedBy } = await resolveShopForCall(call);
  const booking = extractBooking(call, {
    timezone: shop?.timezone ?? 'UTC',
    now,
    defaultCountryCode: shop?.country_code || countryCodeOf(shop?.phone),
    body,
  });
  const tagged = { ...call, _event: event };

  // A call that started tells us nothing bookable yet.
  if (event === 'call_started') {
    return { ok: true, ignored: true, reason: 'awaiting_call_analyzed', shop_id: shop?.id ?? null };
  }

  if (event !== 'call_ended' && event !== 'call_analyzed') {
    return {
      ok: true,
      ignored: true,
      reason: 'awaiting_call_analyzed',
      event,
      shop_id: shop?.id ?? null,
    };
  }

  const forceCompleted = event === 'call_analyzed' || event === 'call_ended';
  const phone =
    booking.phone ||
    booking.caller_number ||
    call.from_number ||
    call.user_number ||
    call.caller_number ||
    call.customer_number ||
    null;
  if (!booking.phone && phone) booking.phone = phone;

  // 1) Call history — ALWAYS upsert for call_ended / call_analyzed (any duration).
  try {
    await upsertCallLog({
      shop: shop ?? null,
      call: tagged,
      booking: { ...booking, phone: phone || booking.phone },
      forceCompleted,
    });
  } catch (error) {
    console.error('[retell-intake] call_log upsert failed:', error?.message || error, error);
  }

  if (!shop) {
    return {
      ok: true,
      ignored: true,
      reason: 'shop_not_matched',
      hint: 'Set the shop\'s retell_agent_id or retell_did / retell_inbound_number / zadarma_did (e.g. +34828643107), or send metadata.shop_id from the Retell agent.',
    };
  }

  // Missed / short / voicemail: history saved; skip Urgencias and reservas.
  const missed = isMissedOrTooShortCall(call);
  if (missed.skip) {
    console.log(
      '[SOLICITUD DESCARTADA] reason=missed_or_short_call |',
      call.call_id,
      missed.durationMs,
      missed.reason,
    );
    console.log('[retell-intake] skipped Urgencias/reservas for missed/short call', {
      call_id: call.call_id,
      event,
      duration_ms: missed.durationMs,
      filter: missed.reason,
      disconnection_reason: call.disconnection_reason ?? null,
      call_successful: call.call_analysis?.call_successful ?? null,
    });
    return {
      ok: true,
      ignored: true,
      reason: 'missed_or_short_call',
      filter: missed.reason,
      duration_ms: missed.durationMs,
      call_id: call.call_id,
      shop_id: shop.id,
      urgencia: null,
      appointment: null,
    };
  }

  // call_ended: historial only — Urgencias wait for call_analyzed + gates.
  if (event === 'call_ended') {
    return {
      ok: true,
      ignored: true,
      reason: 'awaiting_call_analyzed_with_vehicle',
      shop_id: shop.id,
      call_id: call.call_id,
      urgencia: null,
      appointment: null,
    };
  }

  const placeholderName = isPlaceholderCallerName(booking.name);
  const extracted = extractCallAnalyzedFields(body || { call }, call);
  const canCreateReserva = canCreateConfirmedReserva(booking, {
    durationSec: extracted.durationSec,
    vehicle: extracted.vehicle,
  });
  const routeToUrgencias = Boolean(booking.is_urgent) || !canCreateReserva;

  console.log('[RETELL DATA EXTRACTED]', {
    name: extracted.name ?? booking.name ?? null,
    vehicle: extracted.vehicle,
    plate: extracted.plate,
    reason: extracted.reason ?? booking.reason ?? null,
    canCreateReserva,
  });

  console.log('[retell-intake] routing decision', {
    event,
    call_id: call.call_id,
    is_urgent: booking.is_urgent,
    name: booking.name,
    placeholderName,
    canCreateReserva,
    routeToUrgencias,
    durationSec: extracted.durationSec,
    analysisOverrides,
  });

  if (routeToUrgencias) {
    const gates = evaluateUrgenciaGates({ payload: body || { call }, call });
    if (!gates.ok) {
      console.log(
        `[SOLICITUD DESCARTADA] reason=${gates.reason} | Duración: ${gates.durationSec ?? '?'}s | Vehículo: ${gates.rawVehicle ?? 'null'}`,
      );
      return {
        ok: true,
        ignored: true,
        reason: 'urgencia_gates_failed',
        filter: gates.reason,
        duration_sec: gates.durationSec,
        vehicle: gates.rawVehicle,
        shop_id: shop.id,
        call_id: call.call_id,
        urgencia: null,
        appointment: null,
      };
    }
    return saveUrgenciaFromBooking({
      event,
      shop,
      matchedBy,
      call: tagged,
      booking,
      phone,
      forceCompleted,
      now,
      analysisOverrides,
      stubOnly: false,
    });
  }

  // --- Confirmed reserva path (analyzed, non-urgent, real name + motivo + datetime) ---
  if (placeholderName || /^Caller\s*\+34/i.test(String(booking.name || ''))) {
    console.warn('[retell-intake] blocked Caller +34 reserva', {
      call_id: call.call_id,
      name: booking.name,
    });
    return saveUrgenciaFromBooking({
      event,
      shop,
      matchedBy,
      call: tagged,
      booking,
      phone,
      forceCompleted,
      now,
      analysisOverrides,
      stubOnly: false,
    });
  }

  if (!phone) {
    await upsertCallLog({ shop, call: tagged, booking, forceCompleted });
    return { ok: true, ignored: true, reason: 'missing_phone', shop_id: shop.id };
  }

  const existing = await queryOne('SELECT * FROM appointments WHERE external_ref = $1', [externalRef(call.call_id)]);
  const warnings = [];

  let scheduledAt = booking.time.at;
  if (!scheduledAt) {
    console.warn('[retell-intake] missing datetime after canCreateConfirmedReserva — routing to urgencias', {
      call_id: call.call_id,
    });
    return saveUrgenciaFromBooking({
      event,
      shop,
      matchedBy,
      call: tagged,
      booking,
      phone,
      forceCompleted,
      now,
      analysisOverrides,
      stubOnly: false,
    });
  }

  if (booking.time.precision === 'datetime') {
    const check = await checkBookable({ shop, scheduledAt, durationMinutes: shop.slot_minutes, now });
    if (!check.ok) warnings.push(`Requested time is not normally bookable (${check.message}) — confirm with the customer.`);
  }

  const input = {
    customer_name: String(booking.name).trim(),
    customer_phone: booking.phone,
    customer_email: booking.email ?? null,
    vehicle_make: booking.vehicle_make ?? null,
    vehicle_model: booking.vehicle_model ?? null,
    vehicle_plate: booking.plate?.trim() || null,
    service_type: String(booking.reason).trim(),
    notes: composeNotes({ booking, warnings }),
    scheduled_at: scheduledAt,
    duration_minutes: shop.slot_minutes,
    status: 'confirmed',
  };

  console.log('[retell-intake] saving booking with mapped fields', {
    call_id: call.call_id,
    shop_id: shop.id,
    customer_name: input.customer_name,
    vehicle_make: input.vehicle_make,
    vehicle_model: input.vehicle_model,
    vehicle_plate: input.vehicle_plate,
    service_type: input.service_type,
  });

  if (existing) {
    if (['pending', 'accepted', 'confirmed'].includes(existing.status)) {
      const patch = {};
      if (booking.name && existing.customer_name !== booking.name) patch.customer_name = booking.name;
      if (booking.reason && !existing.service_type) patch.service_type = booking.reason;
      if (booking.time.precision === 'datetime' && new Date(existing.scheduled_at).getTime() !== scheduledAt.getTime()) {
        patch.scheduled_at = scheduledAt;
      }
      if (booking.vehicle_make && !existing.vehicle_make) patch.vehicle_make = booking.vehicle_make;
      if (booking.vehicle_model && !existing.vehicle_model) patch.vehicle_model = booking.vehicle_model;
      if (booking.plate && !existing.vehicle_plate) patch.vehicle_plate = booking.plate;
      if (input.notes && input.notes !== existing.notes) patch.notes = input.notes;
      if (Object.keys(patch).length > 0) {
        await updateAppointment({ shop, appointmentId: existing.id, patch });
      }
    }
    await upsertCallLog({ shop, call: tagged, booking, appointmentId: existing.id, forceCompleted });
    const refreshed = await getAppointment(shop.id, existing.id);
    return {
      ok: true,
      stage: event,
      updated: true,
      created: false,
      shop_id: shop.id,
      matched_by: matchedBy,
      urgencia: null,
      appointment: serializeAppointment(refreshed, { timezone: shop.timezone }),
    };
  }

  try {
    const appointment = await createAppointment({
      shop,
      input,
      source: 'retell',
      enforceSchedule: false,
      externalRef: externalRef(call.call_id),
      notify: false,
    });
    console.log('[retell-intake] booking INSERT ok', {
      id: appointment.id,
      customer_name: appointment.customer_name,
      vehicle_make: appointment.vehicle_make,
      vehicle_model: appointment.vehicle_model,
      vehicle_plate: appointment.vehicle_plate,
      service_type: appointment.service_type,
    });

    await upsertCallLog({ shop, call: tagged, booking, appointmentId: appointment.id, forceCompleted });

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
      urgencia: null,
      appointment: serializeAppointment(appointment, { timezone: shop.timezone }),
    };
  } catch (error) {
    console.error('[retell-intake] booking INSERT failed:', error?.message || error, {
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      call_id: call.call_id,
      shop_id: shop.id,
      input,
    });
    throw error;
  }
}

async function saveUrgenciaFromBooking({
  event,
  shop,
  matchedBy,
  call,
  booking,
  phone,
  forceCompleted,
  now,
  analysisOverrides = null,
  stubOnly = false,
}) {
  // Defense in depth: never persist Urgencias without vehicle + duration > 40
  // (analysis bag OR transcript brand fallback).
  if (!stubOnly) {
    const gates = evaluateUrgenciaGates({ payload: { call }, call });
    const overrideVehicle =
      analysisOverrides?.vehiculo && analysisOverrides.vehiculo !== 'Sin vehículo'
        ? analysisOverrides.vehiculo
        : null;
    const rawVehicle = overrideVehicle || gates.rawVehicle;
    const durationSec = gates.durationSec ?? resolveCallDurationSec(call);
    const vehicleOk = hasValidVehicle(rawVehicle);
    const durationOk = durationSec > 40;

    if (!durationOk || !vehicleOk) {
      console.log(
        `[SOLICITUD DESCARTADA] reason=${!durationOk ? 'short_duration' : 'missing_vehicle'} | Duración: ${durationSec ?? '?'}s | Vehículo: ${rawVehicle ?? 'null'}`,
      );
      return {
        ok: true,
        ignored: true,
        reason: 'urgencia_gates_failed',
        duration_sec: durationSec,
        vehicle: rawVehicle,
        shop_id: shop.id,
        urgencia: null,
        appointment: null,
      };
    }
  }

  // Explicit ES/EN mapping from merged analysis (call + body nestings).
  const analysisData = mergeCustomAnalysisData(call, {
    custom_analysis_data: booking.custom_analysis_data,
  });
  const postCallKeys = Object.keys(getPostCallCustomData({ call }) || {});
  const mapped = mapUrgenciaFieldsFromAnalysis(analysisData);

  // Webhook getCustomField overrides win on call_analyzed (force UPDATE).
  const overrideName =
    analysisOverrides?.nombre && analysisOverrides.nombre !== 'Sin nombre'
      ? analysisOverrides.nombre
      : null;
  const overrideVehicle =
    analysisOverrides?.vehiculo && analysisOverrides.vehiculo !== 'Sin vehículo'
      ? analysisOverrides.vehiculo
      : null;
  const overridePlate =
    analysisOverrides?.matricula && analysisOverrides.matricula !== 'Sin matrícula'
      ? analysisOverrides.matricula
      : null;
  const overrideReason =
    analysisOverrides?.motivo && analysisOverrides.motivo !== 'Consulta urgente'
      ? analysisOverrides.motivo
      : null;

  let customerName;
  let vehicleModel;
  let vehicleMake;
  let vehiclePlate;
  let reason;
  let vehicleLabel;

  if (stubOnly) {
    // call_ended: phone + timestamp only — placeholders until analysis arrives.
    customerName = 'Sin nombre';
    vehicleModel = null;
    vehicleMake = null;
    vehiclePlate = 'Sin matrícula';
    reason = 'Consulta urgente';
    vehicleLabel = 'Sin vehículo';
  } else {
    const customerNameRaw =
      overrideName ||
      (mapped.customerName !== 'Sin nombre' ? mapped.customerName : null) ||
      booking.name?.trim() ||
      analysisOverrides?.nombre ||
      null;
    customerName = isPlaceholderCallerName(customerNameRaw)
      ? 'Sin nombre'
      : customerNameRaw || 'Sin nombre';

    vehicleModel =
      booking.vehicle_model?.trim() ||
      mapped.vehicleModel ||
      overrideVehicle ||
      (analysisOverrides?.vehiculo !== 'Sin vehículo' ? analysisOverrides?.vehiculo : null) ||
      null;

    vehicleMake = booking.vehicle_make?.trim() || null;

    const licensePlate =
      overridePlate ||
      (mapped.licensePlate !== 'Sin matrícula' ? mapped.licensePlate : null) ||
      booking.plate?.trim() ||
      analysisOverrides?.matricula ||
      null;
    vehiclePlate = licensePlate || 'Sin matrícula';

    const reasonUrgency =
      overrideReason ||
      (mapped.reasonUrgency !== 'Consulta urgente' ? mapped.reasonUrgency : null) ||
      booking.reason?.trim() ||
      analysisOverrides?.motivo ||
      null;
    reason = reasonUrgency || 'Consulta urgente';

    vehicleLabel =
      vehicleModel ||
      [vehicleMake, booking.vehicle_model].filter(Boolean).join(' ') ||
      booking.vehicle?.trim() ||
      analysisOverrides?.vehiculo ||
      'Sin vehículo';
  }

  const resolvedPhone = phone || booking.phone || 'Sin teléfono';

  console.log('[retell-intake] saving urgencia with mapped fields', {
    call_id: call.call_id,
    shop_id: shop.id,
    event,
    stubOnly,
    forceAnalysis: !stubOnly && event === 'call_analyzed',
    customerName,
    customerPhone: resolvedPhone,
    vehicleMake,
    vehicleModel,
    vehiclePlate,
    vehicleLabel,
    reason,
    is_urgent: booking.is_urgent,
    analysis_keys: postCallKeys,
    analysisOverrides,
  });

  let callLog = null;
  try {
    callLog = await upsertCallLog({
      shop,
      call,
      booking: { ...booking, phone: resolvedPhone },
      forceCompleted,
    });
  } catch (error) {
    console.error('[retell-intake] call_log upsert failed:', error?.message || error, error);
  }

  const calledAt = call.start_timestamp
    ? new Date(call.start_timestamp)
    : call.end_timestamp
      ? new Date(call.end_timestamp)
      : now;
  const existingUrgencia = await queryOne(
    `SELECT id FROM urgencias
      WHERE external_ref = $1
         OR (shop_id = $2 AND customer_phone = $3 AND created_at >= now() - interval '24 hours')
      ORDER BY CASE WHEN external_ref = $1 THEN 0 ELSE 1 END, created_at DESC
      LIMIT 1`,
    [externalRef(call.call_id), shop.id, resolvedPhone],
  );

  let urgencia;
  try {
    urgencia = await upsertUrgencia({
      shopId: shop.id,
      callLogId: callLog?.id ?? null,
      callId: call.call_id,
      title: 'Solicitud de servicio urgente',
      status: 'pending',
      customerName,
      customerPhone: resolvedPhone,
      vehicleMake: vehicleMake || null,
      vehicleModel:
        vehicleModel || (vehicleLabel && vehicleLabel !== 'Sin vehículo' ? vehicleLabel : null),
      vehiclePlate,
      reason,
      summary: stubOnly ? null : booking.summary || reason,
      transcript: stubOnly ? null : booking.transcript,
      calledAt,
      source: 'retell',
      forceAnalysis: !stubOnly && event === 'call_analyzed',
      stubOnly,
      raw: {
        event,
        agent_id: call.agent_id ?? null,
        summary: booking.summary,
        reason,
        is_urgent: booking.is_urgent,
        mapped: {
          nombre: customerName,
          vehiculo: vehicleModel || vehicleLabel,
          matricula: vehiclePlate,
          motivo: reason,
        },
        custom_analysis_data: analysisData,
        analysis_overrides: analysisOverrides,
        args: booking.args,
        retell_llm_dynamic_variables: booking.retell_llm_dynamic_variables,
        collected_dynamic_variables: booking.collected_dynamic_variables,
      },
    });
    console.log('[retell-intake] urgencia upsert ok', {
      id: urgencia?.id,
      created: !existingUrgencia,
      customer_name: urgencia?.customer_name,
      vehicle_make: urgencia?.vehicle_make,
      vehicle_model: urgencia?.vehicle_model,
      vehicle_plate: urgencia?.vehicle_plate,
      reason: urgencia?.reason,
      status: urgencia?.status,
    });
  } catch (error) {
    console.error('[retell-intake] urgencia INSERT/UPDATE failed:', error?.message || error, {
      code: error?.code,
      detail: error?.detail,
      constraint: error?.constraint,
      call_id: call.call_id,
      shop_id: shop.id,
    });
    throw error;
  }

  try {
    await syncUrgenciaToSupabase(urgencia, { callId: call.call_id });
  } catch (error) {
    console.warn('[retell-intake] supabase mirror failed:', error?.message || error);
  }

  const urgenciaPayload = {
    created: !existingUrgencia,
    updated: Boolean(existingUrgencia),
    urgencia: serializeUrgencia(urgencia, { timezone: shop.timezone }),
  };

  if (!existingUrgencia) {
    await query(
      `INSERT INTO notifications (user_id, shop_id, type, title, body, link)
       SELECT m.user_id, $1, 'urgencia', $2, $3, $4 FROM shop_members m WHERE m.shop_id = $1`,
      [
        shop.id,
        '¡NUEVA URGENCIA RECIBIDA!',
        `${urgencia.customer_name} · ${reason}`,
        `/urgencias/${urgencia.id}`,
      ],
    );
    hub.publish(channels.shop(shop.id), {
      type: 'urgencia_created',
      shop_id: shop.id,
      urgencia: urgenciaPayload.urgencia,
    });
    try {
      await notifyNuevaUrgencia(shop.id, urgenciaPayload.urgencia);
    } catch (error) {
      console.error('[retell-intake] web-push failed:', error?.message || error);
    }
  } else if (!stubOnly) {
    hub.publish(channels.shop(shop.id), {
      type: 'urgencia_updated',
      shop_id: shop.id,
      urgencia: urgenciaPayload.urgencia,
    });
  }

  return {
    ok: true,
    stage: event,
    created: urgenciaPayload.created,
    updated: urgenciaPayload.updated,
    shop_id: shop.id,
    matched_by: matchedBy,
    urgencia: urgenciaPayload.urgencia,
    appointment: null,
  };
}

export default { ingestRetellCall, isPlaceholderCallerName, canCreateConfirmedReserva };
