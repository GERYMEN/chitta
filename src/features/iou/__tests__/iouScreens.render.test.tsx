/**
 * R10 render checks: IOU screens/tiles mount without a render loop (stable
 * selectors), the Home tile shows only with an unsettled share and masks in
 * Private mode, and the People screen applies the 30-day settled rule.
 * SYNTHETIC data only.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

jest.mock('../../../data/db/connection', () => ({ getDatabase: jest.fn(), runMigrations: jest.fn() }));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: { personId: 'p1' } }),
    useFocusEffect: () => undefined,
  };
});

import { IouCard } from '../components/IouCard';
import { PeopleScreen } from '../screens/PeopleScreen';
import { PersonIousScreen } from '../screens/PersonIousScreen';
import { SplitSheet } from '../components/SplitSheet';
import { useIouStore } from '../state/iouStore';
import { setRedacted } from '../../../shared/privacy/redaction';
import { IouShare } from '../../../domain/iou/iou.types';
import { Transaction } from '../../../domain/transactions/transaction.types';

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();
const share = (id: string, patch: Partial<IouShare> = {}): IouShare => ({
  id,
  personId: 'p1',
  direction: 'lent',
  sourceTransactionId: null,
  amountMinor: 75000,
  note: null,
  createdAt: daysAgo(40),
  settledAt: null,
  repaymentTransactionId: null,
  ...patch,
});
const person = { id: 'p1', name: 'QA Person One', createdAt: daysAgo(40), updatedAt: daysAgo(40) };

function render(node: React.ReactElement) {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}
const text = (tree: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(tree.toJSON());
const find = (tree: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  tree.root.findAll(n => n.props.testID === testID);

afterEach(() => {
  setRedacted(false);
  useIouStore.setState({ people: [], shares: [] });
});

describe('IouCard (Home tile)', () => {
  it('is hidden with no shares and when every share is settled', () => {
    let tree = render(<IouCard onPress={jest.fn()} />);
    expect(tree.toJSON()).toBeNull();
    useIouStore.setState({ people: [person], shares: [share('s', { settledAt: daysAgo(1) })] });
    tree = render(<IouCard onPress={jest.fn()} />);
    expect(tree.toJSON()).toBeNull();
  });

  it('shows You get / You owe from unsettled shares only, and masks in Private mode', () => {
    useIouStore.setState({
      people: [person],
      shares: [
        share('a', { amountMinor: 75000 }),
        share('b', { direction: 'borrowed', amountMinor: 4000 }),
        share('c', { amountMinor: 999900, settledAt: daysAgo(1) }),
      ],
    });
    const tree = render(<IouCard onPress={jest.fn()} />);
    const out = text(tree);
    expect(out).toContain('You get ₹750');
    expect(out).toContain('You owe ₹40');
    expect(out).not.toContain('9,999');
    setRedacted(true);
    const masked = text(render(<IouCard onPress={jest.fn()} />));
    expect(masked).not.toContain('750');
    expect(masked).toContain('••••');
  });
});

describe('People / Person screens', () => {
  it('People: lists a person with an active share and hides one whose shares are all settled > 30 days ago', () => {
    useIouStore.setState({
      people: [person, { ...person, id: 'p2', name: 'QA Person Two' }],
      shares: [
        share('a'),
        share('old', { personId: 'p2', settledAt: daysAgo(45) }),
      ],
    });
    const tree = render(<PeopleScreen />);
    expect(find(tree, 'people-row').length).toBeGreaterThan(0);
    expect(text(tree)).toContain('QA Person One');
    expect(text(tree)).not.toContain('QA Person Two');
  });

  it('Person: settled > 30 days hidden behind "Show settled", then shown', () => {
    useIouStore.setState({
      people: [person],
      shares: [share('open', { amountMinor: 1000 }), share('old', { amountMinor: 2000, settledAt: daysAgo(45) })],
    });
    const tree = render(<PersonIousScreen />);
    expect(find(tree, 'person-share').filter(n => typeof n.type === 'string' || true).length).toBeGreaterThan(0);
    expect(text(tree)).toContain('Show settled (1)');
    expect(text(tree)).not.toContain('₹20');
    const toggle = find(tree, 'person-show-settled')[0];
    ReactTestRenderer.act(() => toggle.props.onPress());
    expect(text(tree)).toContain('₹20');
  });

  it('masks the person name and amounts in Private mode', () => {
    useIouStore.setState({ people: [person], shares: [share('a')] });
    setRedacted(true);
    const out = text(render(<PeopleScreen />));
    expect(out).not.toContain('QA Person One');
    expect(out).not.toContain('750');
  });
});

describe('SplitSheet', () => {
  it('mounts without a render loop', () => {
    const expense = { id: 'e1', amountMinor: 100000, type: 'expense', status: 'approved' } as Transaction;
    const tree = render(<SplitSheet visible onClose={jest.fn()} expense={expense} />);
    expect(find(tree, 'split-save').length).toBeGreaterThan(0);
    ReactTestRenderer.act(() => tree.unmount());
  });
});
