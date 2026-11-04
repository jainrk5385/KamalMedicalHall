import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';

/**
 * The Firebase *web app* ("Kamal Medical Hall Web") used by the website for Firebase Cloud Messaging push notifications.
 * Phone authentication is handled by the backend OTP API. These values are public by design: they identify the
 * project, they do not grant access. EXPO_PUBLIC_FIREBASE_WEB_CONFIG can override them.
 */
const DEFAULT_CONFIG = {
  apiKey: "AIzaSyBrwWR7Nwz44QONv2UNAfgryxURKMm_So4",
  authDomain: "kamal-medical-hall-814c9.firebaseapp.com",
  projectId: "kamal-medical-hall-814c9",
  storageBucket: "kamal-medical-hall-814c9.firebasestorage.app",
  messagingSenderId: "185387922819",
  appId: "1:185387922819:web:91d8b4e6357a00f09e72b6",
  measurementId: "G-P3TD622WC4"
};

function readConfig(): Record<string, string> {
  const raw = process.env.EXPO_PUBLIC_FIREBASE_WEB_CONFIG;
  if (!raw) return DEFAULT_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    return parsed.messagingSenderId && parsed.appId?.includes(':web:') ? parsed : { ...parsed, ...DEFAULT_CONFIG };
  } catch { return DEFAULT_CONFIG; }
}

export const firebaseWebConfig = readConfig();
export const firebaseWebApp = (): FirebaseApp => getApps()[0] ?? initializeApp(firebaseWebConfig);
