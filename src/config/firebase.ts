import admin from 'firebase-admin';
import { logger } from '../lib/logger';

let initialized = false;

function initFirebaseAdmin(): void {
  if (initialized) return;

  try {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (json) {
      const cred = JSON.parse(json) as admin.ServiceAccount;
      admin.initializeApp({ credential: admin.credential.cert(cred) });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      admin.initializeApp();
    } else {
      throw new Error(
        'Firebase Admin is not configured: set FIREBASE_SERVICE_ACCOUNT (JSON string) or GOOGLE_APPLICATION_CREDENTIALS'
      );
    }
    initialized = true;
  } catch (error) {
    logger.error({ err: error }, 'Firebase Admin initialization failed');
    // Fail hard — do not mark initialized so misconfig is visible and retries can succeed after fix
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/** Call once at process startup so misconfiguration aborts boot. */
export function ensureFirebaseAdminReady(): void {
  initFirebaseAdmin();
}

/** Verifies a Firebase ID token (e.g. from Authorization: Bearer). */
export async function verifyFirebaseIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  initFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken);
}
