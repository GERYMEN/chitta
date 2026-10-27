import { z } from 'zod';
import {
  AUTO_APPROVE_THRESHOLD_MAX,
  AUTO_APPROVE_THRESHOLD_MIN,
  USER_NAME_MAX_LENGTH,
} from '../../../domain/settings/approval.rules';

/** Profile + approval-mode form (onboarding ProfileSetup and Home settings sheet). */
export const profileFormSchema = z.object({
  userName: z
    .string()
    .trim()
    .min(1, 'Please enter your name')
    .max(USER_NAME_MAX_LENGTH, `Name must be ${USER_NAME_MAX_LENGTH} characters or fewer`),
  approvalMode: z.enum(['manual', 'auto']),
  autoApproveThreshold: z
    .number()
    .int()
    .min(AUTO_APPROVE_THRESHOLD_MIN)
    .max(AUTO_APPROVE_THRESHOLD_MAX),
});

export type ProfileFormValues = z.infer<typeof profileFormSchema>;
