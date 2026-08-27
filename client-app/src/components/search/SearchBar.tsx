import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { buildSuggestions, type DecoratedShop } from '@/lib/search';
import { SearchIcon, WrenchIcon } from '@/components/ui/Icons';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  entries: DecoratedShop[];
  onPickService: (slug: string) => void;
}

/** Buscador por texto libre con sugerencias de servicios y talleres. */
export function SearchBar({ value, onChange, entries, onPickService }: SearchBarProps) {
  const navigate = useNavigate();
  const [focused, setFocused] = useState(false);
  const suggestions = useMemo(() => buildSuggestions(entries, value), [entries, value]);
  const showSuggestions = focused && suggestions.length > 0;

  return (
    <div className="relative">
      <div
        className={cn(
          'flex items-center gap-2 rounded-xl border bg-surface px-3.5 transition-colors',
          focused ? 'border-accent ring-2 ring-accent/15' : 'border-line',
        )}
      >
        <SearchIcon className="size-5 shrink-0 text-muted" />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          // El retardo deja pulsar una sugerencia antes de cerrarla.
          onBlur={() => window.setTimeout(() => setFocused(false), 120)}
          placeholder="Taller o servicio: «cambio de aceite», «frenos»…"
          aria-label="Buscar taller o servicio"
          className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:hidden"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            aria-label="Borrar búsqueda"
            className="shrink-0 text-xs font-semibold text-accent"
          >
            Borrar
          </button>
        ) : null}
      </div>

      {showSuggestions ? (
        <ul className="animate-fade-in absolute inset-x-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-line bg-surface shadow-float">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.type}-${suggestion.value}`}>
              <button
                type="button"
                onClick={() => {
                  if (suggestion.type === 'service') {
                    onPickService(suggestion.value);
                    onChange('');
                  } else {
                    navigate(`/taller/${suggestion.value}`);
                  }
                  setFocused(false);
                }}
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-surface-2"
              >
                {suggestion.type === 'service' ? (
                  <WrenchIcon className="size-4 shrink-0 text-accent" />
                ) : (
                  <SearchIcon className="size-4 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {suggestion.label}
                </span>
                <span className="shrink-0 text-[11px] text-muted">
                  {suggestion.type === 'service' ? 'Servicio' : 'Taller'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
