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
import { extractBooking, mergeCustomAnalysisData, pickAnalysisValue, resolveShopForCall } from './retell.js';
import { serializeUrgencia, upsertUrgencia } from './urgencias.js';
import { notifyNuevaUrgencia } from './web-push.js';

/**
 * Turns a finished Retell AI call into a booking on the shop's calendar —
 * or into Urgencias when the call is urgent / incomplete / placeholder.
 */

const externalRef = (callId) => `retell:${callId}`;

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

/** True when Retell already attached post-call extraction bags. */
function hasAnalysisPayload(call = {}, booking = {}) {
  const bags = [
    booking.custom_analysis_data,
    call.call_analysis?.custom_analysis_data,
    call.custom_analysis_data,
    call.args,
    booking.args,
    call.retell_llm_dynamic_variables,
    call.collected_dynamic_variables,
  ];
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object' || Array.isArray(bag)) continue;
    if (Object.keys(bag).length > 0) return true;
  }
  return Boolean(booking.name || booking.reason || booking.vehicle || booking.plate);
}

/**
 * A confirmed reserva requires real analyzed customer data + a captured slot.
 * Anything incomplete (or urgent) goes to Urgencias instead.
 */
export function canCreateConfirmedReserva(booking = {}) {
  if (booking.is_urgent) return false;
  if (isPlaceholderCallerName(booking.name)) return false;
  if (!String(booking.name ?? '').trim()) return false;
  if (!String(booking.reason ?? '').trim()) return false;
  if (booking.time?.precision !== 'datetime') return false;
  return true;
}

/**
 * Processes one Retell webhook.
 * Returns a small result object; the route turns it into the HTTP response.
 */
export async function ingestRetellCall({ event, call, body = null, now = new Date() }) {
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

  // A call that started tells us nothing bookable yet; just open the log entry.
  if (event === 'call_started') {
    await upsertCallLog({ shop, call: tagged, booking });
    return { ok: true, stage: 'call_started', shop_id: shop?.id ?? null, appointment: null };
  }

  // Only call_ended / call_analyzed may create Urgencias or reservas.
  if (event !== 'call_ended' && event !== 'call_analyzed') {
    return { ok: true, ignored: true, reason: 'event_not_processed', event, shop_id: shop?.id ?? null };
  }

  const forceCompleted = true;

  if (!shop) {
    await upsertCallLog({ shop: null, call: tagged, booking, forceCompleted });
    return {
      ok: true,
      ignored: true,
      reason: 'shop_not_matched',
      hint: 'Set the shop\'s retell_agent_id or retell_did / retell_inbound_number / zadarma_did (e.g. +34828643107), or send metadata.shop_id from the Retell agent.',
    };
  }

  const phone =
    booking.phone ||
    booking.caller_number ||
    call.from_number ||
    call.user_number ||
    call.caller_number ||
    call.customer_number ||
    null;

  // call_ended often arrives before analysis — keep Completada in call history only.
  if (event === 'call_ended' && !hasAnalysisPayload(call, booking)) {
    const callLog = await upsertCallLog({ shop, call: tagged, booking, forceCompleted: true });
    console.log('[retell-intake] call_ended without analysis — skipping reservas/urgencias', {
      call_id: call.call_id,
      shop_id: shop.id,
    });
    return {
      ok: true,
      stage: event,
      shop_id: shop.id,
      matched_by: matchedBy,
      deferred: true,
      reason: 'awaiting_call_analyzed',
      call: callLog
        ? {
            id: callLog.id,
            status: callLog.status,
            status_label: callLog.status === 'completed' ? 'Completada' : callLog.status,
            caller_phone: callLog.caller_phone,
          }
        : null,
      urgencia: null,
      appointment: null,
    };
  }

  if (!booking.phone && phone) booking.phone = phone;

  const placeholderName = isPlaceholderCallerName(booking.name);
  const routeToUrgencias = Boolean(booking.is_urgent) || !canCreateConfirmedReserva(booking);

  console.log('[retell-intake] routing decision', {
    event,
    call_id: call.call_id,
    is_urgent: booking.is_urgent,
    name: booking.name,
    placeholderName,
    canCreateReserva: canCreateConfirmedReserva(booking),
    routeToUrgencias,
  });

  if (routeToUrgencias) {
    return saveUrgenciaFromBooking({
      event,
      shop,
      matchedBy,
      call: tagged,
      booking,
      phone,
      forceCompleted,
      now,
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
}) {
  // Re-resolve ES/EN aliases from the merged analysis bag so defaults only apply
  // when Retell truly omitted the field.
  const analysisData = mergeCustomAnalysisData(call, {
    custom_analysis_data: booking.custom_analysis_data,
  });

  const customerNameRaw =
    pickAnalysisValue(analysisData, ['nombre', 'nombre_cliente', 'nombre_completo', 'name', 'customer_name']) ||
    booking.name?.trim() ||
    null;
  const customerName = isPlaceholderCallerName(customerNameRaw)
    ? 'Sin nombre'
    : customerNameRaw || 'Sin nombre';

  const vehicleModel =
    pickAnalysisValue(analysisData, ['vehiculo', 'vehículo', 'vehicle', 'car', 'modelo', 'model']) ||
    booking.vehicle_model?.trim() ||
    booking.vehicle?.trim() ||
    null;

  const vehicleMake =
    pickAnalysisValue(analysisData, ['marca', 'make', 'vehicle_make']) ||
    booking.vehicle_make?.trim() ||
    null;

  const licensePlate =
    pickAnalysisValue(analysisData, ['matricula', 'matrícula', 'plate', 'license_plate', 'placa']) ||
    booking.plate?.trim() ||
    null;
  const vehiclePlate = licensePlate || 'Sin matrícula';

  const reasonUrgency =
    pickAnalysisValue(analysisData, [
      'motivo',
      'motivo_urgencia',
      'motivo_de_urgencia',
      'reason',
      'urgency_reason',
    ]) ||
    booking.reason?.trim() ||
    null;
  const reason = reasonUrgency || 'Consulta urgente';

  const resolvedPhone = phone || booking.phone || 'Sin teléfono';
  const vehicleLabel =
    vehicleModel ||
    [vehicleMake, booking.vehicle_model].filter(Boolean).join(' ') ||
    booking.vehicle?.trim() ||
    'Sin vehículo';

  console.log('[retell-intake] saving urgencia with mapped fields', {
    call_id: call.call_id,
    shop_id: shop.id,
    customerName,
    customerPhone: resolvedPhone,
    vehicleMake,
    vehicleModel,
    vehiclePlate,
    vehicleLabel,
    reason,
    is_urgent: booking.is_urgent,
    analysis_keys: Object.keys(analysisData || {}),
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
  const existingUrgencia = await queryOne('SELECT id FROM urgencias WHERE external_ref = $1', [
    externalRef(call.call_id),
  ]);

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
      vehicleModel: vehicleModel || (vehicleLabel !== 'Sin vehículo' ? vehicleLabel : null),
      vehiclePlate,
      reason,
      summary: booking.summary || reason,
      transcript: booking.transcript,
      calledAt,
      source: 'retell',
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
