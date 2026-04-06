import type { User } from '../generated/prisma/client';

declare global {
  namespace Express {
    interface Request {
      /** Set by Firebase token middleware after verifying the ID token. */
      firebaseAuth?: { uid: string; email?: string };
      /** App user row when the Firebase user is registered in our DB. */
      appUser?: User;
    }
  }
}

export {};
