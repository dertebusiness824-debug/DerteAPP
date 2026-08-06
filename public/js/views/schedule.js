/**
 * Opening hours.
 *
 * What the owner sets here is exactly what the booking form on their Hostinger
 * site will allow, so the screen states that relationship plainly.
 */
import { api } from '../api.js';
import { requireShop, screen, setContent } from '../shell.js';
import { confirmSheet, emptyState, esc, icon, sheet, skeletonList, toast } from '../ui.js';

const DAYS = [
  { weekday: 1, name: 'Lunes' },
  { weekday: 2, name: 'Martes' },
  { weekday: 3, name: 'Miércoles' },
  { weekday: 4, name: 'Jueves' },
  { weekday: 5, name: 'Viernes' },
  { weekday: 6, name: 'Sábado' },
  { weekday: 0, name: 'Domingo' },
];

const timeInput = (weekday, name, label, value) => `
  <div class="field">
    <span class="time-label">${esc(label)}</span>
    <input class="input" type="time" data-day="${weekday}" data-field="${name}" value="${esc(value ?? '')}">
  </div>`;

const dayCard = (day, name) => `
  <div class="day${day.is_closed ? ' day--closed' : ''}" data-day-card="${day.weekday}">
    <div class="day__head">
      <span class="day__name">${esc(name)}</span>
      <label class="switch">
        <input type="checkbox" data-day="${day.weekday}" data-field="is_open" ${day.is_closed ? '' : 'checked'}>
        <span class="field__hint">${day.is_closed ? 'Cerrado' : 'Abierto'}</span>
      </label>
    </div>
    <div class="day__times">
      ${timeInput(day.weekday, 'open_time', 'Abre', day.open_time)}
      ${timeInput(day.weekday, 'close_time', 'Cierra', day.close_time)}
      ${timeInput(day.weekday, 'break_start', 'Descanso desde', day.break_start)}
      ${timeInput(day.weekday, 'break_end', 'Descanso hasta', day.break_end)}
    </div>
  </div>`;

export async function scheduleView() {
  const shop = requireShop({ title: 'Horario de apertura', navKey: 'schedule' });
  if (!shop) return undefined;

  screen({
    title: 'Horario de apertura',
    subtitle: shop.name,
    nav: 'schedule',
    shopSwitcher: true,
    content: skeletonList(4),
  });

  async function load() {
    let schedule;
    try {
      schedule = await api.schedule(shop.id);
    } catch (error) {
      setContent(emptyState('No se pudo cargar el horario', error.message, 'x'));
      return;
    }

    const byWeekday = new Map(schedule.weekly_hours.map((day) => [day.weekday, day]));

    const main = setContent(`
      <div class="stack">
        <div class="card card--flat">
          <div class="row" style="gap:8px">
            ${icon('globe', { size: 17 })}
            <div class="grow">
              <div style="font-weight:620">${esc(schedule.timezone)}</div>
              <div class="list__meta">
                Tu web solo ofrece horarios dentro de estas horas.
                Huecos cada ${esc(schedule.slot_minutes)} min · ${esc(schedule.capacity)} coche${schedule.capacity === 1 ? '' : 's'} a la vez.
              </div>
            </div>
          </div>
        </div>

        <div class="list" style="padding:0">
          ${DAYS.map(({ weekday, name }) => dayCard(byWeekday.get(weekday) ?? { weekday, is_closed: true }, name)).join('')}
        </div>

        <button class="btn btn--block" data-save>Guardar horario de apertura</button>

        <div class="section-title"><span>Días libres y festivos</span>
          <button class="auth__link" data-add-exception>Añadir</button>
        </div>
        ${
          schedule.exceptions.length
            ? `<div class="list">
                 ${schedule.exceptions
                   .map(
                     (exception) => `
                       <div class="list__item list__item--static">
                         <div class="grow">
                           <div class="list__title">${esc(exception.exception_date)}</div>
                           <div class="list__meta">
                             ${exception.is_closed ? 'Cerrado todo el día' : `${esc(exception.open_time)}–${esc(exception.close_time)}`}
                             ${exception.note ? ` · ${esc(exception.note)}` : ''}
                           </div>
                         </div>
                         <button class="btn btn--icon" data-remove="${esc(exception.id)}" aria-label="Eliminar">
                           ${icon('x', { size: 17 })}
                         </button>
                       </div>`,
                   )
                   .join('')}
               </div>`
            : `<div class="card card--flat list__meta">
                 No hay días libres planificados. Añade uno y tu web dejará de aceptar reservas ese día.
               </div>`
        }

        <div class="section-title"><span>Reglas de reserva</span></div>
        <div class="card">
          <div class="stack">
            <div class="field">
              <label class="field__label" for="slot">Duración del hueco (minutos)</label>
              <input class="input" id="slot" type="number" min="5" max="480" step="5" value="${esc(schedule.slot_minutes)}">
            </div>
            <div class="field">
              <label class="field__label" for="capacity">Coches a la vez</label>
              <input class="input" id="capacity" type="number" min="1" max="100" value="${esc(schedule.capacity)}">
            </div>
            <div class="field">
              <label class="field__label" for="notice">Antelación mínima (minutos)</label>
              <input class="input" id="notice" type="number" min="0" max="20160" step="15" value="${esc(schedule.min_notice_minutes)}">
              <span class="field__hint">Bloquea reservas online de última hora. Las llamadas no se ven afectadas.</span>
            </div>
            <div class="field">
              <label class="field__label" for="horizon">Hasta cuántos días por adelantado pueden reservar</label>
              <input class="input" id="horizon" type="number" min="1" max="365" value="${esc(schedule.booking_horizon_days)}">
            </div>
            <button class="btn btn--soft btn--block" data-save-rules>Guardar reglas de reserva</button>
          </div>
        </div>
      </div>`);

    // Toggling a day open/closed hides its time fields immediately.
    main.addEventListener('change', (event) => {
      const toggle = event.target.closest('[data-field="is_open"]');
      if (!toggle) return;
      const card = main.querySelector(`[data-day-card="${toggle.dataset.day}"]`);
      card.classList.toggle('day--closed', !toggle.checked);
      card.querySelector('.switch .field__hint').textContent = toggle.checked ? 'Abierto' : 'Cerrado';
    });

    main.querySelector('[data-save]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;

      const days = DAYS.map(({ weekday }) => {
        const value = (field) => main.querySelector(`[data-day="${weekday}"][data-field="${field}"]`)?.value || null;
        const isOpen = main.querySelector(`[data-day="${weekday}"][data-field="is_open"]`).checked;
        return {
          weekday,
          is_closed: !isOpen,
          open_time: isOpen ? value('open_time') : null,
          close_time: isOpen ? value('close_time') : null,
          break_start: isOpen ? value('break_start') : null,
          break_end: isOpen ? value('break_end') : null,
        };
      });

      try {
        await api.saveSchedule(shop.id, days);
        toast('Horario de apertura guardado', 'ok');
        await load();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });

    main.querySelector('[data-save-rules]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api.updateShop(shop.id, {
          slot_minutes: Number(main.querySelector('#slot').value),
          capacity: Number(main.querySelector('#capacity').value),
          min_notice_minutes: Number(main.querySelector('#notice').value),
          booking_horizon_days: Number(main.querySelector('#horizon').value),
        });
        toast('Reglas de reserva guardadas', 'ok');
        await load();
      } catch (error) {
        toast(error.message, 'error');
        button.disabled = false;
      }
    });

    main.querySelector('[data-add-exception]').addEventListener('click', () => openExceptionSheet(shop, load));

    main.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-remove]');
      if (!remove) return;
      const confirmed = await confirmSheet({
        title: '¿Eliminar este día libre?',
        message: 'Tu web volverá a aceptar reservas para esa fecha.',
        confirmLabel: 'Eliminar',
        danger: true,
      });
      if (!confirmed) return;
      try {
        await api.removeException(shop.id, remove.dataset.remove);
        await load();
      } catch (error) {
        toast(error.message, 'error');
      }
    });
  }

  await load();
  return undefined;
}

function openExceptionSheet(shop, onSaved) {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  sheet({
    title: 'Añadir un día libre',
    body: `
      <form class="stack" novalidate>
        <div class="field">
          <label class="field__label" for="ex-date">Fecha</label>
          <input class="input" id="ex-date" type="date" value="${tomorrow}" required>
        </div>
        <label class="switch">
          <input type="checkbox" id="ex-closed" checked>
          <span class="field__hint">Cerrado todo el día</span>
        </label>
        <div class="grid-2" id="ex-times" hidden>
          <div class="field">
            <span class="time-label">Abre</span>
            <input class="input" id="ex-open" type="time" value="09:00">
          </div>
          <div class="field">
            <span class="time-label">Cierra</span>
            <input class="input" id="ex-close" type="time" value="14:00">
          </div>
        </div>
        <div class="field">
          <label class="field__label" for="ex-note">Motivo (opcional)</label>
          <input class="input" id="ex-note" placeholder="Festivo" maxlength="200">
        </div>
        <div class="field__error" data-error role="alert"></div>
        <button class="btn btn--block" type="submit">Guardar</button>
      </form>`,
    onMount(content, close) {
      const form = content.querySelector('form');
      const closed = form.querySelector('#ex-closed');
      const times = form.querySelector('#ex-times');
      closed.addEventListener('change', () => {
        times.hidden = closed.checked;
      });

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const errorBox = form.querySelector('[data-error]');
        errorBox.textContent = '';
        button.disabled = true;
        try {
          await api.addException(shop.id, {
            date: form.querySelector('#ex-date').value,
            is_closed: closed.checked,
            open_time: closed.checked ? null : form.querySelector('#ex-open').value,
            close_time: closed.checked ? null : form.querySelector('#ex-close').value,
            note: form.querySelector('#ex-note').value.trim() || null,
          });
          close();
          toast('Guardado', 'ok');
          await onSaved();
        } catch (error) {
          errorBox.textContent = error.message;
          button.disabled = false;
        }
      });
    },
  });
}
