import { AuditFeedEvent } from '../../domain/audit/audit.types';
import { Transaction, TransactionType } from '../../domain/transactions/transaction.types';
import { Account } from '../../domain/accounts/account.types';
import { formatRupeesFromMinor } from '../../shared/utils/currency';

/**
 * Pure sentence building for the Activity feed. No React, no store — every
 * string the feed shows comes from here and is unit-tested.
 */

export type ImpactTone = 'income' | 'expense' | 'pending' | 'negative' | 'neutral';

export interface ActivityItem {
  id: string;
  eventAt: string;
  icon: string;
  sentence: string;
  impact: { text: string; tone: ImpactTone } | null;
  /** Set for transaction events — the row opens Transaction Detail. */
  transactionId: string | null;
  /** The transaction no longer exists (Detail shows "Transaction deleted"). */
  transactionDeleted: boolean;
}

export interface ActivityContext {
  /** Live transaction, if it still exists. */
  transaction?: Pick<Transaction, 'merchantName' | 'amountMinor' | 'type'> | null;
  account?: Pick<Account, 'name' | 'lastFour'> | null;
}

const ICON: Record<AuditFeedEvent['eventType'], string> = {
  detected: 'message-text-outline',
  created: 'plus-circle-outline',
  auto_approved: 'lightning-bolt',
  approved: 'check-circle-outline',
  edited: 'pencil-outline',
  rejected: 'close-circle-outline',
  deleted: 'trash-can-outline',
  account_created: 'wallet-plus-outline',
  account_updated: 'wallet-outline',
  account_removed: 'bank-remove',
  account_restored: 'backup-restore',
  settings_changed: 'tune-variant',
};

const FIELD_LABEL: Record<string, string> = {
  type: 'type',
  amountMinor: 'amount',
  merchantName: 'merchant',
  categoryId: 'category',
  accountId: 'account',
  paymentMethod: 'payment method',
  occurredAt: 'date',
  note: 'notes',
  name: 'name',
  lastFour: 'last four digits',
  openingBalanceMinor: 'opening balance',
  balanceAnchorMinor: 'balance',
  balanceAnchorAt: 'balance date',
};

interface Subject {
  merchantName: string;
  amountMinor: number;
  type: TransactionType;
}

function amountLabel(amountMinor: number): string {
  return formatRupeesFromMinor(amountMinor, { showPaise: true });
}

/** "-₹50.00" for an expense, "+₹50.00" for income (DESIGN.md flow notation). */
export function signedAmount(amountMinor: number, type: TransactionType): string {
  return type === 'income'
    ? formatRupeesFromMinor(amountMinor, { showPaise: true, showPositiveSign: true })
    : formatRupeesFromMinor(-amountMinor, { showPaise: true });
}

export function accountShortLabel(account: Pick<Account, 'name' | 'lastFour'> | null | undefined): string {
  if (!account) return 'an account';
  return account.lastFour ? `••${account.lastFour}` : account.name;
}

function fieldList(fields: ReadonlyArray<string>): string {
  const labels = fields.map(field => FIELD_LABEL[field] ?? field);
  return labels.length > 0 ? `Changed ${labels.join(', ')}` : 'No visible changes';
}

function balanceImpact(subject: Subject | null): ActivityItem['impact'] {
  if (!subject) return null;
  return {
    text: `Balance ${signedAmount(subject.amountMinor, subject.type)}`,
    tone: subject.type === 'income' ? 'income' : 'expense',
  };
}

function subjectFor(event: AuditFeedEvent, context: ActivityContext): Subject | null {
  if (context.transaction) return context.transaction;
  if (event.deletedSnapshot) return event.deletedSnapshot;
  if (event.metadata?.kind === 'deleted') return event.metadata;
  return null;
}

/** "QA-Merchant-07 ₹50.00", or "a transaction" when nothing is known. */
function subjectText(subject: Subject | null): string {
  return subject ? `${subject.merchantName} ${amountLabel(subject.amountMinor)}` : 'a transaction';
}

export function describeActivity(
  event: AuditFeedEvent,
  context: ActivityContext = {},
): ActivityItem {
  const subject = subjectFor(event, context);
  const what = subjectText(subject);
  const accountLabel = accountShortLabel(context.account);
  let sentence: string;
  let impact: ActivityItem['impact'] = null;

  switch (event.eventType) {
    case 'created':
      sentence = `You added ${what}`;
      impact = { text: 'Waiting for approval', tone: 'pending' };
      break;
    case 'detected': {
      sentence = `Detected ${what} from SMS`;
      const confidence =
        event.metadata?.kind === 'detected' && event.metadata.confidence !== null
          ? ` · ${Math.round(event.metadata.confidence)}% match`
          : '';
      impact = { text: `Waiting for approval${confidence}`, tone: 'pending' };
      break;
    }
    case 'auto_approved': {
      const confidence =
        event.metadata?.kind === 'auto_approved'
          ? ` at ${Math.round(event.metadata.confidence)}% match`
          : '';
      sentence = `Auto-approved ${what}${confidence}`;
      impact = balanceImpact(subject);
      break;
    }
    case 'approved':
      sentence = `You approved ${what}`;
      impact = balanceImpact(subject);
      break;
    case 'rejected':
      sentence = `You rejected ${what}`;
      impact = { text: 'Not counted in balance', tone: 'neutral' };
      break;
    case 'edited':
      sentence = `You edited ${subject ? subject.merchantName : 'a transaction'}`;
      impact = {
        text: fieldList(event.metadata?.kind === 'edited' ? event.metadata.fields : []),
        tone: 'neutral',
      };
      break;
    case 'deleted': {
      sentence = `You deleted ${what}`;
      const snapshot = event.metadata?.kind === 'deleted' ? event.metadata : event.deletedSnapshot;
      impact =
        snapshot?.status === 'approved'
          ? {
              text: `No longer in balance (was ${signedAmount(snapshot.amountMinor, snapshot.type)})`,
              tone: 'negative',
            }
          : { text: 'Removed from records', tone: 'negative' };
      break;
    }
    case 'account_created':
      sentence = `You added account ${accountLabel}`;
      impact = { text: 'New money source', tone: 'neutral' };
      break;
    case 'account_updated':
      sentence = `You updated account ${accountLabel}`;
      impact = {
        text: fieldList(event.metadata?.kind === 'account_updated' ? event.metadata.fields : []),
        tone: 'neutral',
      };
      break;
    case 'account_removed':
      sentence = `You removed account ${accountLabel}`;
      impact = { text: 'Left totals · its transactions are kept', tone: 'negative' };
      break;
    case 'account_restored':
      sentence = `You restored account ${accountLabel}`;
      impact = { text: 'Counted in totals again', tone: 'income' };
      break;
    case 'settings_changed':
      ({ sentence, impact } = describeSettingsChange(event));
      break;
    default:
      sentence = 'Something changed';
  }

  const isTransactionEvent = event.transactionId !== null;
  return {
    id: event.id,
    eventAt: event.eventAt,
    icon: ICON[event.eventType] ?? 'history',
    sentence,
    impact,
    transactionId: event.transactionId,
    transactionDeleted: isTransactionEvent && !context.transaction,
  };
}

function describeSettingsChange(
  event: AuditFeedEvent,
): Pick<ActivityItem, 'sentence' | 'impact'> {
  const metadata = event.metadata;
  if (metadata?.kind !== 'settings_changed') {
    return { sentence: 'You changed approval settings', impact: null };
  }
  if (metadata.key === 'approval_mode') {
    return {
      sentence: metadata.to === 'auto' ? 'You turned on auto-approve' : 'You turned off auto-approve',
      impact: { text: 'Applies to future SMS syncs', tone: 'neutral' },
    };
  }
  return {
    sentence: `You set the auto-approve threshold to ${metadata.to}%`,
    impact: { text: `Was ${metadata.from}%`, tone: 'neutral' },
  };
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Just now", "5 min ago", "3 h ago" (same day), else the time of day. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return 'Just now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  if (isSameDay(date, now)) return `${Math.floor(minutes / 60)} h ago`;
  return date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function dayHeading(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, now)) return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export interface ActivitySection {
  title: string;
  data: ActivityItem[];
}

/** Items must already be newest first; keeps that order within each day. */
export function groupActivityByDay(
  items: ReadonlyArray<ActivityItem>,
  now: Date = new Date(),
): ActivitySection[] {
  const sections: ActivitySection[] = [];
  let currentKey: string | null = null;
  for (const item of items) {
    const date = new Date(item.eventAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (key !== currentKey) {
      sections.push({ title: dayHeading(item.eventAt, now), data: [] });
      currentKey = key;
    }
    sections[sections.length - 1].data.push(item);
  }
  return sections;
}
