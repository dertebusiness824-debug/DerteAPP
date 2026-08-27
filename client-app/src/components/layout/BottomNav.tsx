import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { CalendarIcon, HeartIcon, HomeIcon, UserIcon } from '@/components/ui/Icons';
import { useActivity } from '@/providers/ActivityProvider';
import { useCatalog } from '@/providers/CatalogProvider';

interface NavItem {
  to: string;
  label: string;
  icon: typeof HomeIcon;
  badge?: number;
}

/** Barra inferior fija: la navegación principal de la app en móvil. */
export function BottomNav() {
  const { upcoming } = useActivity();
  const { favorites } = useCatalog();

  const items: NavItem[] = [
    { to: '/', label: 'Inicio', icon: HomeIcon },
    { to: '/citas', label: 'Mis citas', icon: CalendarIcon, badge: upcoming.length },
    { to: '/favoritos', label: 'Favoritos', icon: HeartIcon, badge: favorites.length },
    { to: '/perfil', label: 'Perfil', icon: UserIcon },
  ];

  return (
    <nav
      aria-label="Navegación principal"
      className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-line bg-surface/95 backdrop-blur"
    >
      <ul className="mx-auto flex max-w-page items-stretch">
        {items.map(({ to, label, icon: ItemIcon, badge }) => (
          <li key={to} className="flex-1">
            <NavLink
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  isActive ? 'text-accent' : 'text-muted hover:text-ink-2',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative">
                    <ItemIcon className="size-6" strokeWidth={isActive ? 2.1 : 1.8} />
                    {badge && badge > 0 ? (
                      <span className="absolute -top-1 -right-2 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] leading-4 font-bold text-white">
                        {badge > 9 ? '9+' : badge}
                      </span>
                    ) : null}
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
