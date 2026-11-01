import { captureRedactedScreenshot, shareFeedback, ShareDeps } from '../feedbackFlow';
import { isRedacted } from '../../../shared/privacy/redaction';
import { FEEDBACK_WHATSAPP_JID } from '../feedback.constants';

const SHOT = { uri: 'file:///cache/feedback/f.png', path: '/cache/feedback/f.png', width: 10, height: 20, bytes: 99 };

describe('captureRedactedScreenshot (R4c)', () => {
  it('captures while REDACTED and always restores', async () => {
    const seen: boolean[] = [];
    const shot = await captureRedactedScreenshot({
      waitForFrame: async () => {
        seen.push(isRedacted());
      },
      capture: async () => {
        seen.push(isRedacted());
        return SHOT;
      },
    });
    expect(shot).toEqual(SHOT);
    expect(seen).toEqual([true, true]);
    expect(isRedacted()).toBe(false);
  });

  it('a failed capture resolves null and still restores', async () => {
    const shot = await captureRedactedScreenshot({
      waitForFrame: async () => undefined,
      capture: async () => {
        throw new Error('E_CAPTURE_FAILED');
      },
    });
    expect(shot).toBeNull();
    expect(isRedacted()).toBe(false);
  });
});

function deps(installed: string[]): ShareDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    shareToPackage: jest.fn(async (pkg: string, jid: string) => {
      calls.push(`pkg:${pkg}:${jid}`);
      return installed.includes(pkg) ? 'sent' : 'not_installed';
    }),
    shareChooser: jest.fn(async () => {
      calls.push('chooser');
      return 'sent' as const;
    }),
    openUrl: jest.fn(async (url: string) => {
      calls.push(`url:${url.split('?')[0]}`);
    }),
  };
}

describe('shareFeedback fallback (R4c)', () => {
  it('WhatsApp first, with the jid', async () => {
    const d = deps(['com.whatsapp', 'com.whatsapp.w4b']);
    expect(await shareFeedback('t', '/p.png', d)).toBe('com.whatsapp');
    expect(d.calls).toEqual([`pkg:com.whatsapp:${FEEDBACK_WHATSAPP_JID}`]);
  });

  it('then WhatsApp Business', async () => {
    const d = deps(['com.whatsapp.w4b']);
    expect(await shareFeedback('t', null, d)).toBe('com.whatsapp.w4b');
    expect(d.calls).toHaveLength(2);
  });

  it('neither installed: wa.me without a screenshot, chooser with one', async () => {
    const noShot = deps([]);
    expect(await shareFeedback('t', null, noShot)).toBe('waMe');
    expect(noShot.calls[2]).toMatch(/^url:https:\/\/wa\.me\//);
    const withShot = deps([]);
    expect(await shareFeedback('t', '/p.png', withShot)).toBe('chooser');
    expect(withShot.calls[2]).toBe('chooser');
    expect(withShot.openUrl).not.toHaveBeenCalled();
  });
});
