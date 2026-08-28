import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { InlineError } from '@/components/ui/States';
import { useRepository } from '@/providers/RepositoryProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

type Tab = 'signin' | 'signup';

/**
 * Panel de acceso global. Cualquier acción que necesite cuenta (reservar,
 * guardar favoritos, pedir urgencia) llama a `requestAuth()` y este panel se
 * abre con el motivo como subtítulo.
 */
export function AuthSheet() {
  const repository = useRepository();
  const { authPrompt, closeAuth, signIn, signUp } = useSession();
  const { notify } = useToast();

  const [tab, setTab] = useState<Tab>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const open = authPrompt !== null;

  useEffect(() => {
    if (open) return;
    setError(null);
    setPending(false);
    setEmailSent(false);
    setPassword('');
  }, [open]);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      if (tab === 'signin') {
        await signIn({ email, password });
        notify('Sesión iniciada', 'success');
      } else {
        const result = await signUp({ email, password, fullName, phone });
        if (result.needsEmailConfirmation) {
          setEmailSent(true);
        } else {
          notify(`Bienvenido, ${fullName.split(' ')[0] || 'conductor'}`, 'success');
        }
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos completar el acceso.');
    } finally {
      setPending(false);
    }
  };

  const canSubmit =
    email.trim().length > 3 &&
    password.length >= 6 &&
    (tab === 'signin' || fullName.trim().length > 1);

  return (
    <Sheet
      open={open}
      onClose={closeAuth}
      title={tab === 'signin' ? 'Entrar en tu cuenta' : 'Crear cuenta'}
      subtitle={authPrompt ?? undefined}
      footer={
        emailSent ? (
          <Button fullWidth onClick={closeAuth}>
            Entendido
          </Button>
        ) : (
          <Button fullWidth loading={pending} disabled={!canSubmit} onClick={() => void submit()}>
            {tab === 'signin' ? 'Entrar' : 'Crear cuenta y continuar'}
          </Button>
        )
      }
    >
      {emailSent ? (
        <div className="space-y-3 py-2 text-center">
          <p className="text-[15px] font-semibold text-ink">Revisa tu correo</p>
          <p className="text-sm text-muted">
            Te hemos enviado un enlace a <span className="font-medium text-ink-2">{email}</span>.
            Confirma la dirección y vuelve para terminar tu reserva.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            {(
              [
                { id: 'signin' as Tab, label: 'Ya tengo cuenta' },
                { id: 'signup' as Tab, label: 'Soy nuevo' },
              ]
            ).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setTab(option.id);
                  setError(null);
                }}
                aria-pressed={tab === option.id}
                className={cn(
                  'rounded-lg py-2 text-[13px] font-semibold transition-colors',
                  tab === option.id ? 'bg-surface text-ink shadow-sm' : 'text-muted',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {error ? <InlineError message={error} /> : null}

          {tab === 'signup' ? (
            <>
              <TextField
                label="Nombre y apellidos"
                required
                autoComplete="name"
                placeholder="Lucía Fernández"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
              />
              <TextField
                label="Teléfono de contacto"
                type="tel"
                autoComplete="tel"
                hint="El taller lo usa para avisarte de tu cita."
                placeholder="600 123 456"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </>
          ) : null}

          <TextField
            label="Email"
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            placeholder="tu@email.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <TextField
            label="Contraseña"
            type="password"
            required
            autoComplete={tab === 'signin' ? 'current-password' : 'new-password'}
            hint="Mínimo 6 caracteres."
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canSubmit && !pending) void submit();
            }}
          />

          {repository.mode === 'demo' ? (
            <p className="rounded-card bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
              En modo demo no hay servidor de cuentas: cualquier email con una contraseña de 6
              caracteres crea un perfil local en este navegador.
            </p>
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
