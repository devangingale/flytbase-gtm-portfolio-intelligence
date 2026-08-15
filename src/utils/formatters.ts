/**
 * Formats a currency amount into compact or standard USD notation ($240k, $1.84M, etc.)
 */
export function formatCurrency(amount: number | null | undefined, compact = true): string {
  if (amount === null || amount === undefined) return '$0';
  if (amount === 0) return '$0';

  if (compact) {
    if (Math.abs(amount) >= 1_000_000) {
      const millions = amount / 1_000_000;
      return `$${millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(2)}M`;
    }
    if (Math.abs(amount) >= 1_000) {
      const thousands = amount / 1_000;
      return `$${thousands % 1 === 0 ? thousands.toFixed(0) : thousands.toFixed(0)}k`;
    }
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Formats standard ISO dates to readable forms like "Nov 01, 2026"
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'Not scheduled';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Formats ISO timestamps with hour/min: "Aug 15, 11:41 UTC"
 */
export function formatTimestamp(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    }) + ' UTC';
  } catch {
    return dateString;
  }
}

/**
 * Calculates days until a target date
 */
export function daysUntil(dateString: string | null | undefined): number | null {
  if (!dateString) return null;
  try {
    const target = new Date(dateString);
    if (isNaN(target.getTime())) return null;
    const now = new Date();
    const diffTime = target.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

/**
 * Formats lifecycle stage into a clean human label (no em dashes)
 */
export function formatStage(stage: string | null | undefined): string {
  if (!stage) return 'Unknown';
  switch (stage.toLowerCase()) {
    case 'active_customer':
      return 'Active Customer';
    case 'onboarding':
      return 'Onboarding';
    case 'renewal_pending':
      return 'Renewal Pending';
    case 'prospect':
      return 'Prospect';
    case 'churned':
      return 'Churned';
    default:
      return stage.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

/**
 * Formats role into a clean label
 */
export function formatRole(role: string | null | undefined): string {
  if (!role) return 'Contact';
  switch (role.toLowerCase()) {
    case 'champion':
      return 'Champion';
    case 'economic_buyer':
      return 'Economic Buyer';
    case 'evaluator':
      return 'Evaluator';
    case 'former_champion':
      return 'Former Champion';
    default:
      return role.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

/**
 * Formats change feed entry type
 */
export function formatChangeType(type: string): string {
  switch (type) {
    case 'document_added':
      return 'Document Added';
    case 'document_withdrawn':
      return 'Document Withdrawn';
    case 'usage_updated':
      return 'Usage Updated';
    case 'account_rederived':
      return 'Account Re-Derived';
    case 'claim_invalidated':
      return 'Claim Invalidated';
    default:
      return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

/**
 * Formats document type to label
 */
export function formatDocType(type: string): string {
  switch (type) {
    case 'call_transcript':
      return 'Call Transcript';
    case 'email':
      return 'Email';
    case 'support_ticket':
      return 'Support Ticket';
    case 'usage_record':
      return 'Usage Record';
    case 'internal_note':
      return 'Internal Note';
    default:
      return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
