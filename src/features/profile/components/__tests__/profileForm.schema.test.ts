import { profileFormSchema } from '../profileForm.schema';

const valid = { userName: 'QA User', approvalMode: 'manual' as const, autoApproveThreshold: 90 };

describe('profileFormSchema', () => {
  it('accepts a valid profile and trims the name', () => {
    const result = profileFormSchema.safeParse({ ...valid, userName: '  QA User  ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.userName).toBe('QA User');
  });

  it('rejects an empty or whitespace name', () => {
    expect(profileFormSchema.safeParse({ ...valid, userName: '' }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...valid, userName: '   ' }).success).toBe(false);
  });

  it('enforces the 30-character limit after trimming', () => {
    expect(profileFormSchema.safeParse({ ...valid, userName: 'a'.repeat(30) }).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...valid, userName: 'a'.repeat(31) }).success).toBe(false);
    expect(
      profileFormSchema.safeParse({ ...valid, userName: ` ${'a'.repeat(30)} ` }).success,
    ).toBe(true);
  });

  it('restricts the threshold to integers 70..100', () => {
    expect(profileFormSchema.safeParse({ ...valid, autoApproveThreshold: 70 }).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...valid, autoApproveThreshold: 100 }).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...valid, autoApproveThreshold: 69 }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...valid, autoApproveThreshold: 101 }).success).toBe(false);
    expect(profileFormSchema.safeParse({ ...valid, autoApproveThreshold: 90.5 }).success).toBe(
      false,
    );
  });

  it('only allows manual or auto', () => {
    expect(profileFormSchema.safeParse({ ...valid, approvalMode: 'auto' }).success).toBe(true);
    expect(profileFormSchema.safeParse({ ...valid, approvalMode: 'other' }).success).toBe(false);
  });
});
