import { isDestructiveDialog, showDialog, useDialogStore } from '../dialogStore';

const flush = () => new Promise<void>(resolve => setImmediate(() => resolve()));

describe('dialogStore', () => {
  beforeEach(() => {
    useDialogStore.setState({ current: null });
  });

  it('showDialog makes the dialog visible with its actions', () => {
    showDialog({
      title: 'Delete transaction?',
      message: 'This will permanently remove the record.',
      icon: 'trash-can-outline',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Delete', variant: 'destructive', onPress: jest.fn() },
      ],
    });

    const current = useDialogStore.getState().current;
    expect(current?.title).toBe('Delete transaction?');
    expect(current?.actions.map(a => a.label)).toEqual(['Cancel', 'Delete']);
    expect(current && isDestructiveDialog(current)).toBe(true);
  });

  it('defaults to a single OK action', () => {
    showDialog({ title: 'Account already exists' });
    const current = useDialogStore.getState().current;
    expect(current?.actions).toEqual([{ label: 'OK', variant: 'primary' }]);
    expect(current && isDestructiveDialog(current)).toBe(false);
  });

  it('pressing an action closes the dialog and calls its handler', async () => {
    const onDelete = jest.fn();
    showDialog({
      title: 'Delete transaction?',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Delete', variant: 'destructive', onPress: onDelete },
      ],
    });

    const deleteAction = useDialogStore.getState().current!.actions[1];
    useDialogStore.getState().press(deleteAction);
    await flush();

    expect(useDialogStore.getState().current).toBeNull();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('dismiss closes without calling the destructive handler', async () => {
    const onDelete = jest.fn();
    showDialog({
      title: 'Delete transaction?',
      actions: [
        { label: 'Cancel', variant: 'ghost' },
        { label: 'Delete', variant: 'destructive', onPress: onDelete },
      ],
    });

    useDialogStore.getState().dismiss();
    await flush();

    expect(useDialogStore.getState().current).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });
});
