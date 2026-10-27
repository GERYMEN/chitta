export type AuditEventType =
  | 'detected'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'deleted'
  | 'account_created'
  | 'account_updated';

export type AuditActor = 'system' | 'user';

export interface AuditEvent {
  id: string;
  transactionId: string | null;
  eventType: AuditEventType;
  eventAt: string;
  actor: AuditActor;
  metadataJson: string | null;
  previousHash: string | null;
  eventHash: string | null;
}
