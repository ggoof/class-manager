/**
 * Firebase Analytics for the hosted SPA.
 *
 * This is the *only* thing the browser bundle uses Firebase for — the app's data
 * never goes near the client SDK. Every read and write goes through the API,
 * which holds a service account and enforces the role checks; `firestore.rules`
 * denies client access outright. Keep it that way: a browser talking to
 * Firestore directly would bypass every authorization check in the backend.
 *
 * The config below is public by design (it identifies the project, it does not
 * grant anything), but it lives in env vars so a fork can point at its own
 * project without editing code. With no config set, this no-ops.
 */
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported } from 'firebase/analytics';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

export async function startAnalytics() {
  if (!config.apiKey || !config.measurementId) return;
  // Analytics needs cookies and IndexedDB; `isSupported` covers the browsers and
  // privacy modes where it would otherwise throw on load.
  if (!(await isSupported().catch(() => false))) return;
  getAnalytics(initializeApp(config));
}
