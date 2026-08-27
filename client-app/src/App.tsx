import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { appConfig } from '@/config';
import { AuthSheet } from '@/components/auth/AuthSheet';
import { RouteFallback } from '@/components/layout/RouteFallback';
import { ActivityProvider } from '@/providers/ActivityProvider';
import { CatalogProvider } from '@/providers/CatalogProvider';
import { LocationProvider } from '@/providers/LocationProvider';
import { RepositoryProvider } from '@/providers/RepositoryProvider';
import { SessionProvider } from '@/providers/SessionProvider';
import { ToastProvider } from '@/providers/ToastProvider';
import { HomeScreen } from '@/screens/HomeScreen';

// La home entra en el primer trozo; el resto de pantallas se descargan al
// navegar, que en móvil es lo que mantiene el arranque ligero.
const ShopDetailScreen = lazy(() =>
  import('@/screens/ShopDetailScreen').then((module) => ({ default: module.ShopDetailScreen })),
);
const AppointmentsScreen = lazy(() =>
  import('@/screens/AppointmentsScreen').then((module) => ({ default: module.AppointmentsScreen })),
);
const FavoritesScreen = lazy(() =>
  import('@/screens/FavoritesScreen').then((module) => ({ default: module.FavoritesScreen })),
);
const ProfileScreen = lazy(() =>
  import('@/screens/ProfileScreen').then((module) => ({ default: module.ProfileScreen })),
);

/**
 * `basename` sale de `VITE_MARKETPLACE_BASE_PATH`, así que la PWA se puede
 * servir tanto en la raíz de su dominio como en una subruta del hosting de
 * derteapp sin tocar el código.
 */
const basename = (typeof __MARKETPLACE_ENV__ === 'undefined' ? '/' : __MARKETPLACE_ENV__.basePath)
  .replace(/\/+$/, '');

export function App() {
  return (
    <BrowserRouter basename={basename || '/'}>
      <RepositoryProvider>
        <ToastProvider>
          <SessionProvider>
            <CatalogProvider>
              <ActivityProvider>
                <LocationProvider>
                  <Suspense fallback={<RouteFallback />}>
                    <Routes>
                      <Route path="/" element={<HomeScreen />} />
                      <Route path="/taller/:shopId" element={<ShopDetailScreen />} />
                      <Route path="/citas" element={<AppointmentsScreen />} />
                      <Route path="/favoritos" element={<FavoritesScreen />} />
                      <Route path="/perfil" element={<ProfileScreen />} />
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </Suspense>

                  {/* Un único panel de acceso para toda la app: cualquier
                      pantalla puede pedirlo con `requestAuth()`. */}
                  <AuthSheet />
                  <title>{appConfig.appName}</title>
                </LocationProvider>
              </ActivityProvider>
            </CatalogProvider>
          </SessionProvider>
        </ToastProvider>
      </RepositoryProvider>
    </BrowserRouter>
  );
}
