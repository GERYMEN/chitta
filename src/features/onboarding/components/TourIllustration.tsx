import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, Chip, TransactionRow } from '../../../shared/ui';
import { PendingTransactionCard } from '../../pending/components/PendingTransactionCard';
import { Icon } from '../../../shared/icons';
import { colors, spacing } from '../../../theme';
import { TourStepId } from '../models/tourSteps';
import {
  approvedTransactionFixtures,
  pendingTransactionFixtures,
} from '../../../test/fixtures/transactions.fixture';
import { accountFixtures } from '../../../test/fixtures/accounts.fixture';
import { getCategoryVisual } from '../../../shared/constants/categoryVisuals';
import { formatTransactionTimestamp } from '../../../shared/utils/date';

/**
 * Each slide previews the *real* shared component it is teaching, instead
 * of a one-off mock illustration — keeps the tour visually identical to
 * the product and free of drift.
 */
export function TourIllustration({ stepId }: { stepId: TourStepId }) {
  switch (stepId) {
    case 'welcome':
      return (
        <View style={styles.stack}>
          <Card style={styles.card}>
            <Chip label="UPI SMS · Just now" tone="neutral" />
          </Card>
          <Icon name="arrow-down" size={20} color={colors.outline} style={styles.arrow} />
          <PendingTransactionCard
            transaction={pendingTransactionFixtures[0]}
            onApprove={() => {}}
            onReview={() => {}}
          />
        </View>
      );

    case 'dashboard':
      return (
        <View style={styles.stack}>
          <Card tone="obsidian" style={styles.miniBalance}>
            <Chip label="Combined Net Worth" tone="active" />
          </Card>
          {approvedTransactionFixtures.slice(0, 2).map(t => {
            const visual = getCategoryVisual(t.categoryId);
            return (
              <TransactionRow
                key={t.id}
                merchantName={t.merchantName}
                subtitle={formatTransactionTimestamp(t.occurredAt)}
                amountMinor={t.amountMinor}
                type={t.type}
                status={t.status}
                icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              />
            );
          })}
        </View>
      );

    case 'detection':
      return (
        <View style={styles.stack}>
          <Card style={styles.card}>
            <Chip label="Detected" tone="pending" icon={<Icon name="radar" size={14} color="#B7791F" />} />
          </Card>
          <Icon name="arrow-down" size={20} color={colors.outline} style={styles.arrow} />
          <Card style={styles.card}>
            <Chip label="Pending — not recorded" tone="neutral" />
          </Card>
        </View>
      );

    case 'approval':
      return (
        <View style={styles.stack}>
          {pendingTransactionFixtures.slice(0, 1).map(t => (
            <PendingTransactionCard key={t.id} transaction={t} onApprove={() => {}} onReview={() => {}} />
          ))}
        </View>
      );

    case 'history':
      return (
        <View style={styles.stack}>
          {approvedTransactionFixtures.slice(0, 3).map(t => {
            const visual = getCategoryVisual(t.categoryId);
            return (
              <TransactionRow
                key={t.id}
                merchantName={t.merchantName}
                subtitle={formatTransactionTimestamp(t.occurredAt)}
                amountMinor={t.amountMinor}
                type={t.type}
                status={t.status}
                icon={<Icon name={visual.icon} size={22} color={visual.iconColor} />}
              />
            );
          })}
        </View>
      );

    case 'accounts':
      return (
        <View style={styles.stack}>
          {accountFixtures.slice(0, 2).map(account => (
            <Card key={account.id} style={styles.card}>
              <Chip label={account.name} tone="neutral" />
            </Card>
          ))}
        </View>
      );

    default:
      return null;
  }
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.sm,
  },
  card: {
    gap: spacing.xs,
  },
  miniBalance: {
    gap: spacing.xs,
  },
  arrow: {
    alignSelf: 'center',
  },
});
