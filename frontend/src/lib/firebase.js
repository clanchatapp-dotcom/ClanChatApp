/**
 * Firebase Web SDK bootstrap for ClanChat.
 *
 * The config comes from the backend (`GET /api/firebase/config`) rather
 * than a hard-coded object here so operations can rotate keys without
 * a frontend rebuild. Values are cached in-memory once fetched.
 *
 * All Firebase objects (app, auth, storage) are exposed via async
 * getters so the SDK is only initialised once the config is available.
 *
 * Session persistence: Firebase's default `browserLocalPersistence` is
 * kept — that's what makes login sticky across app reloads and Capacitor
 * cold starts.
 */
import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  onIdTokenChanged,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth";
import { getStorage } from "firebase/storage";
import axios from "axios";

const BACKEND = process.env.REACT_APP_BACKEND_URL || "";
const CONFIG_ENDPOINT = `${BACKEND}/api/firebase/config`;

let _configPromise = null;
let _appPromise = null;

async function loadConfig() {
  if (_configPromise) return _configPromise;
  _configPromise = axios.get(CONFIG_ENDPOINT).then((r) => r.data);
  return _configPromise;
}

/** Returns the initialised Firebase app. Idempotent. */
export async function getFirebaseApp() {
  if (_appPromise) return _appPromise;
  _appPromise = (async () => {
    const cfg = await loadConfig();
    if (!cfg?.apiKey || !cfg?.projectId) {
      throw new Error("Firebase config unavailable — backend returned empty apiKey/projectId");
    }
    const existing = getApps()[0];
    return existing || initializeApp(cfg);
  })();
  return _appPromise;
}

/** Returns the initialised Firebase Auth instance with persistence set. */
export async function getFirebaseAuth() {
  const app = await getFirebaseApp();
  const auth = getAuth(app);
  // Persistence has to be set before any sign-in. Try IndexedDB first
  // (works inside the Android WebView + iOS Safari private mode) and
  // fall back to localStorage.
  try {
    await setPersistence(auth, indexedDBLocalPersistence);
  } catch {
    try { await setPersistence(auth, browserLocalPersistence); } catch { /* noop */ }
  }
  return auth;
}

export async function getFirebaseStorage() {
  const app = await getFirebaseApp();
  return getStorage(app);
}

// ------------------------------------------------------------------
// Auth helpers — thin wrappers so pages don't have to import the raw
// modular API surface.
// ------------------------------------------------------------------
export async function fbSignInEmail(email, password) {
  const auth = await getFirebaseAuth();
  return signInWithEmailAndPassword(auth, email, password);
}

export async function fbSignUpEmail(email, password) {
  const auth = await getFirebaseAuth();
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function fbSendPasswordReset(email) {
  const auth = await getFirebaseAuth();
  return sendPasswordResetEmail(auth, email);
}

export async function fbSignInGoogle() {
  const auth = await getFirebaseAuth();
  const provider = new GoogleAuthProvider();
  // Popup on desktop, redirect on mobile — popups get blocked inside the
  // Capacitor WebView.
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative || window.matchMedia("(max-width: 700px)").matches) {
    await signInWithRedirect(auth, provider);
    return null; // caller should await getRedirectResult on load
  }
  return signInWithPopup(auth, provider);
}

export async function fbGetRedirectResult() {
  const auth = await getFirebaseAuth();
  return getRedirectResult(auth);
}

export async function fbSignOut() {
  try {
    const auth = await getFirebaseAuth();
    await firebaseSignOut(auth);
  } catch { /* ignore */ }
}

/** Fresh ID token for the currently-signed-in Firebase user, or null. */
export async function fbGetIdToken(forceRefresh = false) {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

/** Subscribe to Firebase auth state changes. Fires immediately with the
 *  cached user (or null) and then whenever it changes. Returns the
 *  unsubscribe function. */
export function onFirebaseAuth(cb) {
  let unsub = () => {};
  getFirebaseAuth().then((auth) => {
    unsub = onAuthStateChanged(auth, cb);
  });
  return () => unsub();
}

/** Fires whenever Firebase issues a fresh ID token (login, refresh,
 *  provider link). Useful for exchanging the token for a fresh ClanChat
 *  JWT in the background. */
export function onFirebaseIdTokenRefresh(cb) {
  let unsub = () => {};
  getFirebaseAuth().then((auth) => {
    unsub = onIdTokenChanged(auth, cb);
  });
  return () => unsub();
}
