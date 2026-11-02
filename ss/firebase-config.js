/*
 * Firebase web configuration.
 *
 * 1. Open the Firebase Console for your project.
 * 2. Project settings (gear icon) → Your apps → Web app (</>).
 * 3. Copy the `firebaseConfig` object and replace the placeholder values below.
 * 4. Enable Google (and Email/Password, Anonymous if you use Guest Mode) under
 *    Authentication → Sign-in method.
 * 5. Make sure `localhost` and your deployed domain are listed under
 *    Authentication → Settings → Authorized domains.
 *
 * Until the placeholders are replaced the site runs in local demo mode, so the
 * UI stays usable while you set Firebase up.
 */
window.FIREBASE_CONFIG = {
    apiKey: "PASTE_API_KEY",
    authDomain: "PASTE_PROJECT_ID.firebaseapp.com",
    projectId: "PASTE_PROJECT_ID",
    storageBucket: "PASTE_PROJECT_ID.appspot.com",
    messagingSenderId: "PASTE_SENDER_ID",
    appId: "PASTE_APP_ID"
};
