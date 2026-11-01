import React from 'react';
import { StyleSheet, Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { FeedbackSheet, FeedbackSheetProps } from '../components/FeedbackSheet';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

function render(overrides: Partial<FeedbackSheetProps> = {}) {
  const props: FeedbackSheetProps = {
    visible: true,
    onClose: jest.fn(),
    versionLabel: 'v1.0 (1)',
    category: 'bug',
    onCategoryChange: jest.fn(),
    note: '',
    onNoteChange: jest.fn(),
    screenshotUri: 'file:///cache/feedback/qa.png',
    onRetake: jest.fn(),
    onRemove: jest.fn(),
    onAdd: jest.fn(),
    onSend: jest.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<FeedbackSheet {...props} />);
  });
  return { renderer, props };
}

function byTestId(renderer: ReactTestRenderer.ReactTestRenderer, id: string) {
  return renderer.root.findAll(node => node.props.testID === id && typeof node.type !== 'string')[0];
}

function allText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => (Array.isArray(node.props.children) ? node.props.children.join('') : String(node.props.children)))
    .join(' | ');
}

describe('FeedbackSheet (R4c)', () => {
  it('header, version badge, pills (Bug selected), counter, screenshot caption, WhatsApp button', () => {
    const { renderer } = render({ note: 'abc' });
    const text = allText(renderer);
    expect(text).toContain('Share Feedback');
    expect(text).toContain('v1.0 (1)');
    expect(text).toContain('Bug 🪲');
    expect(text).toContain('Idea 💡');
    expect(text).toContain('Review 💬');
    expect(text).toContain('3/500');
    expect(text).toContain('✓ Screenshot (auto-captured, amounts hidden)');
    expect(text).toContain('Send on WhatsApp');
    expect(byTestId(renderer, 'feedback-category-bug').props.accessibilityState).toEqual({ checked: true });
    expect(byTestId(renderer, 'feedback-category-idea').props.accessibilityState).toEqual({ checked: false });
    const send = byTestId(renderer, 'feedback-send');
    expect(send.props.disabled).toBe(false);
    const style = StyleSheet.flatten(send.props.style({ pressed: false }));
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
    expect(style.backgroundColor).toBe('#25D366');
  });

  it('single-select pills report the chosen category; the note is capped at 500', () => {
    const { renderer, props } = render();
    act(() => byTestId(renderer, 'feedback-category-idea').props.onPress());
    expect(props.onCategoryChange).toHaveBeenCalledWith('idea');
    const note = byTestId(renderer, 'feedback-note');
    expect(note.props.maxLength).toBe(500);
    act(() => note.props.onChangeText('z'.repeat(520)));
    expect(props.onNoteChange).toHaveBeenCalledWith('z'.repeat(500));
  });

  it('Retake / Remove with a screenshot; Add after removal', () => {
    const { renderer, props } = render();
    act(() => byTestId(renderer, 'feedback-retake').props.onPress());
    act(() => byTestId(renderer, 'feedback-remove').props.onPress());
    expect(props.onRetake).toHaveBeenCalled();
    expect(props.onRemove).toHaveBeenCalled();
    const removed = render({ screenshotUri: null });
    expect(allText(removed.renderer)).toContain('No screenshot attached');
    act(() => byTestId(removed.renderer, 'feedback-add').props.onPress());
    expect(removed.props.onAdd).toHaveBeenCalled();
  });

  it('send is disabled only with no category and an empty note', () => {
    const { renderer } = render({ category: null, note: '  ' });
    expect(byTestId(renderer, 'feedback-send').props.disabled).toBe(true);
    const ok = render({ category: null, note: 'hello' });
    expect(byTestId(ok.renderer, 'feedback-send').props.disabled).toBe(false);
  });
});
