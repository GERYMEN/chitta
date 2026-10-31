import React from 'react';
import { StyleSheet } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { HEADER_BUTTON_SIZE, HeaderBackButton, HeaderSpacer } from '../HeaderBackButton';

describe('B2: shared header back button', () => {
  it('is a 48×48dp button announced as "Back"', async () => {
    const onPress = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<HeaderBackButton onPress={onPress} />);
    });
    const button = r.root.findAll(n => n.props.testID === 'header-back' && typeof n.type !== 'string')[0];
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Back');
    const style = StyleSheet.flatten(button.props.style({ pressed: false }));
    expect(HEADER_BUTTON_SIZE).toBe(48);
    expect(style.width).toBeGreaterThanOrEqual(48);
    expect(style.height).toBeGreaterThanOrEqual(48);
    await ReactTestRenderer.act(async () => {
      button.props.onPress();
    });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the spacer is the same 48dp so titles stay centred', async () => {
    let r!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      r = ReactTestRenderer.create(<HeaderSpacer />);
    });
    const child = r.root.findByType(HeaderSpacer).children[0];
    const style = StyleSheet.flatten(typeof child === 'string' ? undefined : child.props.style);
    expect(style).toMatchObject({ width: 48, height: 48 });
  });
});
