import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SyncStartOptions } from '../SyncStartOptions';
import { BalanceCard } from '../../../home/components/BalanceCard';

function rows(renderer: ReactTestRenderer.ReactTestRenderer) {
  return renderer.root.findAll(
    node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function',
  );
}

describe('SyncStartOptions (R4b)', () => {
  it('4 radio rows with helper text, install recommended + selected, ≥48dp rows', () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<SyncStartOptions value="install" onChange={() => {}} />);
    });
    const radios = rows(renderer);
    expect(radios).toHaveLength(4);
    expect(radios[0].props.accessibilityLabel).toMatch(/^From install date, recommended\. Start empty/);
    expect(radios[0].props.accessibilityState).toMatchObject({ checked: true });
    expect(radios[1].props.accessibilityState).toMatchObject({ checked: false });
    for (const radio of radios) {
      const style = StyleSheet.flatten(radio.props.style({ pressed: false }));
      expect(style.minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it('pressing a row reports its mode; Settings adds "Pick a date"', () => {
    const onChange = jest.fn();
    const onPick = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <SyncStartOptions value={null} onChange={onChange} showCustom customLabel="14 Oct 2026" onPickCustom={onPick} />,
      );
    });
    const radios = rows(renderer);
    expect(radios).toHaveLength(5);
    act(() => radios[2].props.onPress());
    expect(onChange).toHaveBeenCalledWith('3m');
    act(() => radios[4].props.onPress());
    expect(onPick).toHaveBeenCalled();
    expect(radios[4].props.accessibilityLabel).toContain('From 14 Oct 2026');
  });
});

describe('BalanceCard scan progress (R4b)', () => {
  it('shows "Scanning N / M" + Cancel in place of the buttons', () => {
    const onCancel = jest.fn();
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <BalanceCard
          totalBalanceMinor={0}
          onAddRecord={() => {}}
          onSyncSms={() => {}}
          syncProgress={{ scanned: 1200, total: 4800, cancelling: false }}
          onCancelSync={onCancel}
        />,
      );
    });
    const texts = renderer.root
      .findAll(node => typeof node.props.children === 'string')
      .map(node => node.props.children);
    expect(texts).toContain('Scanning 1,200 / 4,800');
    expect(texts).not.toContain('Sync SMS');
    const cancel = renderer.root.findByProps({ testID: 'sync-cancel' });
    act(() => cancel.props.onPress());
    expect(onCancel).toHaveBeenCalled();
  });
});
