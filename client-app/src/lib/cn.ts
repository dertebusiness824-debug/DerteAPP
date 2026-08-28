type ClassValue = string | false | null | undefined;

/** Une clases de Tailwind descartando las condicionales vacías. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
