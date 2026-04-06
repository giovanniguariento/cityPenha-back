import admin from 'firebase-admin';

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
  } catch (error) {
    console.log(error)
  }

  initialized = true;
}

/** Verifies a Firebase ID token (e.g. from Authorization: Bearer). */
export async function verifyFirebaseIdToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
  initFirebaseAdmin();
  return admin.auth().verifyIdToken(idToken);
}
