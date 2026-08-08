/** Insights: website traffic, bookings and phone activity for one shop. */
import { api } from '../api.js';
import { navigate } from '../router.js';
import { requireShop, screen, setContent } from '../shell.js';
import { barChart, duration, emptyState, esc, icon, num, skeletonList } from '../ui.js';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 30, label: '30 días' },
  { days: 90, label: '90 días' },
];

export async function insightsView({ query }) {
  const shop = requireShop({ title: 'Estadísticas', navKey: 'home' });
  if (!shop) return undefined;

  const days = Number(query.get('days')) || 30;

  screen({
    title: 'Estadísticas',
    subtitle: shop.name,
    back: '/',
    nav: 'home',
    shopSwitcher: true,
    content: skeletonList(5),
  });

  let data;
  let calls;
  try {
    [data, calls] = await Promise.all([api.analytics(shop.id, days), api.callStats(shop.id, days)]);
  } catch (error) {
    setContent(emptyState('No se pudieron cargar las estadísticas', error.message, 'x'));
    return undefined;
  }

  const bookings = data.appointments;
  const traffic = data.traffic;
  const completionRate = bookings.total ? Math.round((bookings.completed / bookings.total) * 100) : 0;

  const main = setContent(`
    <div class="stack">
      <div class="segmented" role="tablist">
        ${RANGES.map(
          (range) =>
            `<button role="tab" data-days="${range.days}" aria-pressed="${range.days === days}">${esc(range.label)}</button>`,
        ).join('')}
      </div>

      <div class="section-title"><span>Reservas</span></div>
      <div class="stats">
        <div class="stat">
          <div class="stat__value">${num(bookings.total)}</div>
          <div class="stat__label">Solicitudes recibidas</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(bookings.completed)}</div>
          <div class="stat__label">Trabajos completados</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(bookings.pending ?? bookings.confirmed ?? 0)}</div>
          <div class="stat__label">Confirmadas</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(bookings.in_progress ?? 0)}</div>
          <div class="stat__label">En curso</div>
        </div>
      </div>

      ${
        data.daily.length
          ? `<div class="card">
               <div class="card__label">Solicitudes por día</div>
               ${barChart(data.daily.map((point) => ({ label: point.day.slice(5), value: point.bookings })))}
             </div>`
          : ''
      }

      <div class="card">
        <div class="card__label">Tasa de finalización</div>
        <div class="row" style="gap:10px;margin-top:8px">
          <div class="meter grow"><div class="meter__fill" style="width:${completionRate}%"></div></div>
          <strong>${completionRate}%</strong>
        </div>
        <div class="kv" style="margin-top:8px">
          <span class="kv__key">Canceladas</span><span class="kv__value">${num(bookings.cancelled)}</span>
        </div>
        <div class="kv"><span class="kv__key">No presentados</span><span class="kv__value">${num(bookings.no_show)}</span></div>
        ${
          bookings.completed_value
            ? `<div class="kv"><span class="kv__key">Valor del trabajo completado</span><span class="kv__value">${num(bookings.completed_value)}</span></div>`
            : ''
        }
      </div>

      <div class="section-title"><span>Tu web</span></div>
      <div class="stats">
        <div class="stat">
          <div class="stat__value">${num(traffic.visitors)}</div>
          <div class="stat__label">Visitantes</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(traffic.pageviews)}</div>
          <div class="stat__label">Páginas vistas</div>
        </div>
        <div class="stat">
          <div class="stat__value">${num(traffic.form_submits)}</div>
          <div class="stat__label">Formularios enviados</div>
        </div>
        <div class="stat">
          <div class="stat__value">${traffic.form_conversion_rate}%</div>
          <div class="stat__label">Conversión del formulario</div>
        </div>
      </div>

      ${
        data.traffic_daily.length
          ? `<div class="card">
               <div class="card__label">Visitantes por día</div>
               ${barChart(data.traffic_daily.map((point) => ({ label: point.day.slice(5), value: point.visitors })), { muted: true })}
             </div>`
          : ''
      }

      <div class="card">
        <div class="kv"><span class="kv__key">Clics en llamar</span><span class="kv__value">${num(traffic.call_clicks)}</span></div>
        <div class="kv"><span class="kv__key">Clics en WhatsApp</span><span class="kv__value">${num(traffic.whatsapp_clicks)}</span></div>
        <div class="kv"><span class="kv__key">Consultas de disponibilidad</span><span class="kv__value">${num(traffic.schedule_checks)}</span></div>
        <div class="kv"><span class="kv__key">Desde el móvil</span><span class="kv__value">${
          traffic.mobile_hits + traffic.desktop_hits
            ? `${Math.round((traffic.mobile_hits / (traffic.mobile_hits + traffic.desktop_hits)) * 100)}%`
            : '—'
        }</span></div>
      </div>

      <div class="section-title"><span>Teléfono</span>
        <a href="/settings/telephony" style="font-size:12px">Configurar</a>
      </div>
      <div class="stats stats--three">
        <div class="stat">
          <div class="stat__value">${num(calls.total)}</div>
          <div class="stat__label">Llamadas</div>
        </div>
        <div class="stat${calls.missed ? ' stat--alert' : ''}">
          <div class="stat__value">${num(calls.missed)}</div>
          <div class="stat__label">Perdidas</div>
        </div>
        <div class="stat">
          <div class="stat__value">${calls.avg_seconds ? duration(calls.avg_seconds) : '—'}</div>
          <div class="stat__label">Media</div>
        </div>
      </div>

      ${
        data.top_services.length
          ? `<div class="section-title"><span>Trabajos más solicitados</span></div>
             <div class="card">
               ${data.top_services
                 .map(
                   (service) => `
                     <div class="kv">
                       <span class="kv__key">${esc(service.service)}</span>
                       <span class="kv__value">${num(service.count)}</span>
                     </div>`,
                 )
                 .join('')}
             </div>`
          : ''
      }

      <div class="section-title"><span>Origen de las reservas</span></div>
      <div class="card">
        ${
          data.sources.length
            ? data.sources
                .map(
                  (source) => `
                    <div class="kv">
                      <span class="kv__key">${esc(sourceLabel(source.source))}</span>
                      <span class="kv__value">${num(source.count)}</span>
                    </div>`,
                )
                .join('')
            : `<div class="list__meta">${icon('inspect', { size: 16 })} Aún no hay reservas en este periodo.</div>`
        }
      </div>
    </div>`);

  main.addEventListener('click', (event) => {
    const range = event.target.closest('[data-days]');
    if (range) navigate(`/insights?days=${range.dataset.days}`);
  });
  return undefined;
}

const SOURCE_LABELS = {
  hostinger: 'Tu web',
  dashboard: 'Añadida en DerteApp',
  phone: 'Llamada',
  walk_in: 'Presencial',
  api: 'API',
};

const sourceLabel = (source) => SOURCE_LABELS[source] ?? source;
