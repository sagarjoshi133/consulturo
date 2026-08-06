// Firebase Web SDK shim for Phone Auth on web (Platform.OS === 'web').
// Exposes a tiny API surface that matches the bits of @react-native-firebase/auth
// the phone-auth modal uses, so the modal code can stay identical:
//
//   const conf = await firebaseAuth().signInWithPhoneNumber(fullPhone)
//   const cred = await conf.confirm(code)
//   const idToken = await cred.user.getIdToken()
//
// The Web SDK requires a reCAPTCHA verifier — we create an INVISIBLE one
// the first time `signInWithPhoneNumber` is called and re-use it. The
// reCAPTCHA badge will appear briefly in the bottom-right corner during
// verification (Google's anti-fraud requirement; cannot be hidden).

import { Platform } from 'react-native';
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInWithPhoneNumber as fbSignInWithPhoneNumber,
  RecaptchaVerifier,
  Auth,
  ConfirmationResult,
} from 'firebase/auth';

// Web config — matches the Android `google-services.json` plus the
// web-app id provided by Firebase Console (separate from the Android one).
const FIREBASE_WEB_CONFIG = {
  apiKey: 'AIzaSyA8oPYsTL2OV9DvbGrUu8CM3DdszL3q4g4',
  authDomain: 'consulturo-87dfa.firebaseapp.com',
  projectId: 'consulturo-87dfa',
  storageBucket: 'consulturo-87dfa.firebasestorage.app',
  messagingSenderId: '671401583801',
  appId: '1:671401583801:web:3fe09b7141335c5634e768',
};

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;
let _verifier: RecaptchaVerifier | null = null;

function ensureApp(): Auth {
  if (Platform.OS !== 'web') {
    throw new Error('firebase-web is web-only');
  }
  if (!_app) {
    _app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_WEB_CONFIG);
  }
  if (!_auth) {
    _auth = getAuth(_app);
  }
  return _auth;
}

function ensureRecaptchaContainer(): string {
  // Create a hidden DOM container for the invisible reCAPTCHA. We do this
  // lazily because Expo Router renders to a single root <div>, and we
  // don't want to add elements unless the user actually triggers phone
  // auth.
  if (typeof document === 'undefined') return 'recaptcha-container';
  let el = document.getElementById('recaptcha-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'recaptcha-container';
    el.style.position = 'fixed';
    el.style.bottom = '0';
    el.style.right = '0';
    el.style.zIndex = '9999';
    document.body.appendChild(el);
  }
  return 'recaptcha-container';
}

function ensureVerifier(): RecaptchaVerifier {
  const auth = ensureApp();
  if (_verifier) return _verifier;
  const containerId = ensureRecaptchaContainer();
  _verifier = new RecaptchaVerifier(auth, containerId, {
    size: 'invisible',
  });
  return _verifier;
}

/**
 * Reset the cached reCAPTCHA verifier — call this if a phone-auth attempt
 * fails (Firebase requires a fresh verifier on each retry of an expired
 * challenge).
 */
function resetVerifier() {
  try {
    _verifier?.clear();
  } catch {}
  _verifier = null;
}

/** Confirmation result wrapper matching the @react-native-firebase shape. */
type WebConfirmation = {
  confirm: (code: string) => Promise<{
    user: {
      getIdToken: () => Promise<string>;
    };
  }>;
};

async function signInWithPhoneNumber(phoneNumber: string): Promise<WebConfirmation> {
  const auth = ensureApp();
  const verifier = ensureVerifier();
  let confirmation: ConfirmationResult;
  try {
    confirmation = await fbSignInWithPhoneNumber(auth, phoneNumber, verifier);
  } catch (e) {
    // On error the verifier may be in a stale state — wipe it so the
    // next retry creates a fresh one.
    resetVerifier();
    throw e;
  }
  return {
    confirm: async (code: string) => {
      const credential = await confirmation.confirm(code);
      // Web SDK shape: credential.user.getIdToken() — already matches RN.
      return {
        user: {
          getIdToken: () => credential.user!.getIdToken(),
        },
      };
    },
  };
}

/**
 * Default export shaped like `@react-native-firebase/auth`'s
 * `firebaseAuth().signInWithPhoneNumber(...)` so the phone-auth modal
 * code can use a single API on both platforms.
 */
function authFactory() {
  // Touch the auth instance early so any init errors throw eagerly.
  ensureApp();
  return {
    signInWithPhoneNumber,
  };
}

export default authFactory;
export { resetVerifier };
