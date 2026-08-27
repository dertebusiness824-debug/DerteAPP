import { useMemo, useState } from 'react';
import type { ShopReview } from '@/data/types';
import { formatRelative } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { TextAreaField } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { StarPicker, Stars } from '@/components/ui/Stars';
import { InlineError } from '@/components/ui/States';
import { useActivity } from '@/providers/ActivityProvider';
import { useRepository } from '@/providers/RepositoryProvider';
import { useSession } from '@/providers/SessionProvider';
import { useToast } from '@/providers/ToastProvider';

const COLLAPSED_COUNT = 3;

interface ReviewSectionProps {
  shopId: string;
  reviews: ShopReview[];
  ratingAvg: number;
  ratingCount: number;
  onSubmitted: () => void;
}

/**
 * Opiniones reales: solo puede publicar quien ya tiene una cita con ese taller,
 * y la lista se recarga tras publicar para que la media cuadre con la ficha.
 */
export function ReviewSection({
  shopId,
  reviews,
  ratingAvg,
  ratingCount,
  onSubmitted,
}: ReviewSectionProps) {
  const repository = useRepository();
  const { items } = useActivity();
  const { isSignedIn, requestAuth } = useSession();
  const { notify } = useToast();

  const [expanded, setExpanded] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visitedService = useMemo(() => {
    const visit = items.find(
      (item) =>
        item.shopId === shopId &&
        (item.kind === 'urgent' || (item.status !== 'cancelled' && item.status !== 'no_show')),
    );
    if (!visit) return null;
    return visit.kind === 'booking' ? visit.serviceName : 'Asistencia urgente';
  }, [items, shopId]);

  const distribution = useMemo(() => {
    const buckets = [0, 0, 0, 0, 0];
    for (const review of reviews) {
      const index = Math.min(4, Math.max(0, Math.round(review.rating) - 1));
      buckets[index] += 1;
    }
    return buckets;
  }, [reviews]);

  const openComposer = () => {
    if (!isSignedIn) {
      requestAuth('Entra en tu cuenta para valorar este taller');
      return;
    }
    setError(null);
    setComposerOpen(true);
  };

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await repository.submitReview({
        shopId,
        rating,
        comment: comment.trim() || null,
        serviceTag: visitedService,
      });
      setComposerOpen(false);
      setComment('');
      notify('Gracias por tu opinión', 'success');
      onSubmitted();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No pudimos publicar tu opinión.');
    } finally {
      setPending(false);
    }
  };

  const visible = expanded ? reviews : reviews.slice(0, COLLAPSED_COUNT);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-3">
        <div className="text-center">
          <p className="text-[26px] leading-none font-bold text-ink">
            {ratingCount > 0 ? ratingAvg.toFixed(1).replace('.', ',') : '—'}
          </p>
          <Stars rating={ratingAvg} showValue={false} className="mt-1" />
          <p className="mt-1 text-[11px] text-muted">
            {ratingCount} opinion{ratingCount === 1 ? '' : 'es'}
          </p>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((star) => {
            const total = reviews.length || 1;
            const percentage = Math.round((distribution[star - 1] / total) * 100);
            return (
              <div key={star} className="flex items-center gap-2">
                <span className="w-3 shrink-0 text-[11px] text-muted">{star}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                  <span
                    className="block h-full rounded-full bg-warn"
                    style={{ width: `${percentage}%` }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {reviews.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-5 text-center text-sm text-muted">
          Todavía no hay opiniones de este taller. Sé el primero en contarlo.
        </p>
      ) : (
        <ul className="space-y-2">
          {visible.map((review) => (
            <li key={review.id} className="rounded-card border border-line bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold text-ink">{review.authorName}</p>
                  <Stars rating={review.rating} showValue={false} className="mt-0.5" />
                </div>
                <span className="shrink-0 text-[11px] text-muted">
                  {formatRelative(review.createdAt)}
                </span>
              </div>
              {review.comment ? (
                <p className="mt-2 text-[13px] text-ink-2">{review.comment}</p>
              ) : null}
              {review.serviceTag ? (
                <p className="mt-1.5 text-[11px] text-muted">Servicio: {review.serviceTag}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-3">
        {reviews.length > COLLAPSED_COUNT ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="text-[13px] font-semibold text-accent"
          >
            {expanded ? 'Ver menos' : `Ver las ${reviews.length} opiniones`}
          </button>
        ) : (
          <span />
        )}

        {visitedService !== null || !isSignedIn ? (
          <Button size="sm" variant="outline" onClick={openComposer}>
            Escribir opinión
          </Button>
        ) : null}
      </div>

      {visitedService === null && isSignedIn ? (
        <p className="text-xs text-muted">
          Solo publican opinión los conductores que ya han pasado por este taller.
        </p>
      ) : null}

      <Sheet
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        title="¿Cómo ha ido?"
        subtitle={visitedService ? `Servicio: ${visitedService}` : undefined}
        footer={
          <Button fullWidth loading={pending} onClick={() => void submit()}>
            Publicar opinión
          </Button>
        }
      >
        <div className="space-y-4">
          {error ? <InlineError message={error} /> : null}
          <div className="flex justify-center">
            <StarPicker value={rating} onChange={setRating} />
          </div>
          <TextAreaField
            label="Cuéntaselo a otros conductores"
            hint="Trato, plazos, transparencia en el precio…"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
      </Sheet>
    </div>
  );
}
