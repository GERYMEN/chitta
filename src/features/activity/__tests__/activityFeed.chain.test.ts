/**
 * R5i (G3, D-i) — Activity copy for chain suggestion events. Ids + enum kind
 * only; the sentence describes the child row (masked). SYNTHETIC ids.
 */
import { ActivityContext, describeActivity } from '../activityFeed';
import { AuditFeedEvent, AuditMetadata } from '../../../domain/audit/audit.types';

function event(eventType: AuditFeedEvent['eventType'], metadata: AuditMetadata): AuditFeedEvent {
  return {
    id: 'aud-1',
    seq: 1,
    transactionId: 'child-1',
    accountId: null,
    eventType,
    eventAt: '2026-11-21T10:00:00.000Z',
    actor: eventType === 'chain_suggested' ? 'system' : 'user',
    metadata,
    deletedSnapshot: null,
  };
}

const CTX: ActivityContext = { transaction: { merchantName: 'QA Merchant', amountMinor: 50000, type: 'income' } };

describe('chain suggestion activity copy', () => {
  it('chain_suggested (refund) names the relation', () => {
    const item = describeActivity(
      event('chain_suggested', { kind: 'chain_suggested', childId: 'child-1', parentId: 'p', chainKind: 'refund_link' }),
      CTX,
    );
    expect(item.sentence).toMatch(/linked .* as a refund/i);
    expect(item.impact?.tone).toBe('pending');
  });

  it('chain_suggested (incomplete) says waiting for a matching alert', () => {
    const item = describeActivity(
      event('chain_suggested', { kind: 'chain_suggested', childId: 'child-1', parentId: null, chainKind: 'incomplete' }),
      CTX,
    );
    expect(item.sentence).toMatch(/waiting for a matching alert/i);
  });

  it('chain_accepted and chain_dismissed read as user actions', () => {
    const accepted = describeActivity(
      event('chain_accepted', { kind: 'chain_accepted', childId: 'child-1', parentId: 'p', chainKind: 'transfer_twin' }),
      CTX,
    );
    expect(accepted.sentence).toMatch(/you accepted/i);
    const dismissed = describeActivity(
      event('chain_dismissed', { kind: 'chain_dismissed', childId: 'child-1', chainKind: 'duplicate' }),
      CTX,
    );
    expect(dismissed.sentence).toMatch(/you dismissed/i);
  });
});
