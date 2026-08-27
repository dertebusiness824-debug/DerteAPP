import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { useId } from 'react';
import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink placeholder:text-muted/70 ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/15 focus:outline-none disabled:bg-surface-2';

interface FieldShellProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  children: (id: string) => ReactNode;
}

function FieldShell({ label, hint, error, required, children }: FieldShellProps) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-urgent">*</span> : null}
      </label>
      {children(id)}
      {error ? (
        <p className="text-xs font-medium text-urgent">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextField({ label, hint, error, className, ...rest }: TextFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id) => (
        <input
          id={id}
          className={cn(CONTROL, error && 'border-urgent focus:border-urgent', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function TextAreaField({ label, hint, error, className, ...rest }: TextAreaFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id) => (
        <textarea
          id={id}
          rows={3}
          className={cn(CONTROL, 'resize-none', error && 'border-urgent', className)}
          {...rest}
        />
      )}
    </FieldShell>
  );
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string;
  hint?: string;
  error?: string | null;
}

export function SelectField({ label, hint, error, className, children, ...rest }: SelectFieldProps) {
  return (
    <FieldShell label={label} hint={hint} error={error} required={rest.required}>
      {(id) => (
        <select id={id} className={cn(CONTROL, 'appearance-none pr-9', className)} {...rest}>
          {children}
        </select>
      )}
    </FieldShell>
  );
}
