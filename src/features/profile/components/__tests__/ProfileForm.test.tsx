import React from 'react';
import { Switch, Text, View } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ProfileForm } from '../ProfileForm';
import { ProfileFormValues } from '../profileForm.schema';

async function renderForm(initialValues: ProfileFormValues) {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <ProfileForm
        initialValues={initialValues}
        onSubmit={jest.fn()}
        submitLabel="Save"
      />,
    );
  });
  return renderer;
}

const thresholdSlider = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.find(
    n =>
      n.props.testID === 'threshold-slider' &&
      n.props.accessibilityRole === 'adjustable',
  );

describe('ProfileForm approval toggle', () => {
  const base: ProfileFormValues = {
    userName: 'QA User',
    approvalMode: 'manual',
    autoApproveThreshold: 90,
  };

  it('renders an Auto-approve switch, off for manual, with the threshold dimmed + disabled', async () => {
    const r = await renderForm(base);
    const sw = r.root.findByType(Switch);
    expect(sw.props.value).toBe(false);
    expect(sw.props.accessibilityLabel).toBe('Auto-approve');
    expect(sw.props.accessibilityRole).toBe('switch');
    expect(thresholdSlider(r).props.accessibilityState).toEqual({
      disabled: true,
    });
    expect(JSON.stringify(r.toJSON())).toContain(
      'Turn on Auto-approve to use the threshold',
    );
  });

  it('toggling the switch on enables the threshold without unmounting it', async () => {
    const r = await renderForm(base);
    await ReactTestRenderer.act(() => {
      r.root.findByType(Switch).props.onValueChange(true);
    });
    expect(r.root.findByType(Switch).props.value).toBe(true);
    expect(thresholdSlider(r).props.accessibilityState).toEqual({
      disabled: false,
    });
    expect(JSON.stringify(r.toJSON())).not.toContain('Turn on Auto-approve');
  });

  it('starts on for auto mode', async () => {
    const r = await renderForm({ ...base, approvalMode: 'auto' });
    expect(r.root.findByType(Switch).props.value).toBe(true);
    expect(thresholdSlider(r).props.accessibilityState).toEqual({
      disabled: false,
    });
  });

  it('shows the threshold note only when auto and above 90', async () => {
    const note = (r: ReactTestRenderer.ReactTestRenderer) =>
      r.root.findAll(n => n.props.testID === 'threshold-note' && n.type === Text);
    const autoHigh = await renderForm({
      ...base,
      approvalMode: 'auto',
      autoApproveThreshold: 95,
    });
    expect(JSON.stringify(autoHigh.toJSON())).toContain(
      "SMS matches currently score up to 90%, so thresholds above 90% won't auto-approve anything yet.",
    );
    expect(note(autoHigh)).toHaveLength(1);
    const autoAt90 = await renderForm({ ...base, approvalMode: 'auto' });
    expect(note(autoAt90)).toHaveLength(0);
    const manualHigh = await renderForm({ ...base, autoApproveThreshold: 95 });
    expect(note(manualHigh)).toHaveLength(0);
  });

  it('reserves a fixed min height for the variable copy', async () => {
    const r = await renderForm(base);
    const block = r.root.find(
      n => n.props.testID === 'threshold-copy-block' && n.type === View,
    );
    const style = Array.isArray(block.props.style)
      ? Object.assign({}, ...block.props.style)
      : block.props.style;
    expect(style.minHeight).toBe(84);
  });
});
