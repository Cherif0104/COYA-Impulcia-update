-- Contrainte CHECK : autoriser partially_paid + recalcul déterministe des statuts (idempotent)

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (
    status IS NULL
    OR status IN ('draft', 'sent', 'paid', 'overdue', 'partially_paid')
  );

-- Aligner le statut stocké sur les montants (paid_amount vs amount)
UPDATE public.invoices
SET status = 'partially_paid',
    updated_at = COALESCE(updated_at, now())
WHERE COALESCE(amount, 0) > 0
  AND COALESCE(paid_amount, 0) > 0
  AND COALESCE(paid_amount, 0) < COALESCE(amount, 0);

UPDATE public.invoices
SET status = 'paid',
    updated_at = COALESCE(updated_at, now())
WHERE COALESCE(amount, 0) > 0
  AND COALESCE(paid_amount, 0) >= COALESCE(amount, 0)
  AND COALESCE(paid_amount, 0) > 0;

-- Statut partiel incohérent (aucun paiement enregistré)
UPDATE public.invoices
SET status = 'sent',
    updated_at = COALESCE(updated_at, now())
WHERE status = 'partially_paid'
  AND (
    COALESCE(paid_amount, 0) <= 0
    OR COALESCE(amount, 0) <= 0
    OR COALESCE(paid_amount, 0) >= COALESCE(amount, 0)
  );
