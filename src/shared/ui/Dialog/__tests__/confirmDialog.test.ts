import { confirmDialog, useDialogStore } from '../dialogStore';

const flush = () => new Promise<void>(resolve => setTimeout(() => resolve(), 0));

describe('confirmDialog (R4b)', () => {
  afterEach(() => useDialogStore.setState({ current: null }));

  it('resolves true on the confirm action', async () => {
    const answer = confirmDialog({ title: 'Large SMS scan', confirmLabel: 'Scan' });
    const current = useDialogStore.getState().current!;
    expect(current.actions.map(a => a.label)).toEqual(['Cancel', 'Scan']);
    useDialogStore.getState().press(current.actions[1]);
    await flush();
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false on Cancel', async () => {
    const answer = confirmDialog({ title: 'Large SMS scan', confirmLabel: 'Scan' });
    const current = useDialogStore.getState().current!;
    useDialogStore.getState().press(current.actions[0]);
    await expect(answer).resolves.toBe(false);
  });

  it('resolves false when dismissed by back/scrim', async () => {
    const answer = confirmDialog({ title: 'Large SMS scan', confirmLabel: 'Scan' });
    useDialogStore.getState().dismiss();
    await flush();
    await expect(answer).resolves.toBe(false);
  });
});
