import { devProvider, type OtpProvider } from './devProvider';

export const otpProvider: OtpProvider = devProvider();