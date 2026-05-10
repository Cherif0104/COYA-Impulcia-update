/**
 * Statut de facture déterministe : priorité aux montants (paid_amount vs amount)
 * plutôt qu'à un champ `status` potentiellement désynchronisé.
 */

export function derivePersistedInvoiceStatus(
  amount: number,
  paidAmount: number | null | undefined,
  requestedStatus: string | undefined | null
): string {
  const total = Number(amount) || 0;
  let paid = 0;
  if (paidAmount !== null && paidAmount !== undefined && paidAmount !== '') {
    const n = Number(paidAmount);
    if (!Number.isNaN(n) && n > 0) paid = n;
  }

  if (total > 0 && paid > 0 && paid < total) {
    return 'partially_paid';
  }
  if (total > 0 && paid >= total && paid > 0) {
    return 'paid';
  }

  const raw = (requestedStatus || 'draft').toLowerCase().replace(/\s+/g, '_');
  const allowed = ['draft', 'sent', 'paid', 'overdue', 'partially_paid'];
  if (!allowed.includes(raw)) return 'draft';
  if (raw === 'partially_paid') return 'sent';
  if (raw === 'paid' && paid <= 0 && total > 0) return 'sent';
  return raw;
}

/** Statut canonique DB (snake_case) après lecture — corrige les lignes incohérentes. */
export function effectiveInvoiceStatusFromRow(row: {
  status?: string | null;
  amount?: unknown;
  paid_amount?: unknown;
}): string {
  const total = Number(row.amount) || 0;
  const paid = Number(row.paid_amount) || 0;
  const raw = (row.status || 'draft').toLowerCase().replace(/\s+/g, '_');

  if (total > 0 && paid > 0 && paid < total) return 'partially_paid';
  if (total > 0 && paid >= total && paid > 0) return 'paid';
  if (raw === 'partially_paid') return 'sent';
  return raw;
}
