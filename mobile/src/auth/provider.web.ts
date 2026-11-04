import type { OtpProvider } from './shared';
import { serverProvider } from './serverProvider';

export const otpProvider: OtpProvider = serverProvider();