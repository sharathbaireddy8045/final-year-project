/*
 * Firebase Authentication bridge.
 *
 * Loaded as a module so it can use the Firebase v10 modular SDK from the CDN.
 * The UI code stays framework-free and calls `window.BlissAuth`:
 *
 *   BlissAuth.isConfigured          -> true when real Firebase keys are present
 *   BlissAuth.onChange(cb)          -> subscribe to the session (null when signed out)
 *   BlissAuth.google()              -> Google popup sign-in
 *   BlissAuth.emailLogin(email,pw)  -> email + password sign-in
 *   BlissAuth.emailSignup(name,e,p) -> create an email account
 *   BlissAuth.guest()               -> anonymous (guest) sign-in
 *   BlissAuth.resetPassword(email)  -> send a reset email
 *   BlissAuth.logout()              -> sign out
 *
 * When the config is still using placeholders, or Firebase cannot start, the
 * page falls back to the local demo login so the site keeps working.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
    getAuth,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    updateProfile,
    signInAnonymously,
    signOut,
    sendPasswordResetEmail,
    onAuthStateChanged,
    setPersistence,
    browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

var config = window.FIREBASE_CONFIG || {};
var configured = Boolean(
    config.apiKey &&
    config.projectId &&
    config.appId &&
    !/PASTE|YOUR_/i.test(config.apiKey + config.projectId + config.appId)
);

var auth = null;
var initError = "";

if (configured) {
    try {
        var app = initializeApp(config);
        auth = getAuth(app);
        setPersistence(auth, browserLocalPersistence).catch(function () {});
    } catch (error) {
        initError = (error && error.message) || "Firebase failed to initialise.";
        auth = null;
    }
}

var ERROR_MESSAGES = {
    "auth/invalid-email": "That email address looks invalid.",
    "auth/missing-password": "Please enter your password.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-not-found": "No account was found with that email.",
    "auth/wrong-password": "Email or password is incorrect.",
    "auth/email-already-in-use": "An account with this email already exists. Please log in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/popup-closed-by-user": "Sign-in was cancelled.",
    "auth/cancelled-popup-request": "Sign-in was cancelled.",
    "auth/popup-blocked": "The browser blocked the sign-in popup. Allow popups and try again.",
    "auth/unauthorized-domain": "This domain is not authorised in Firebase. Add localhost (or your domain) under Authentication \u2192 Settings \u2192 Authorized domains.",
    "auth/operation-not-allowed": "This sign-in method is disabled in Firebase. Enable it under Authentication \u2192 Sign-in method.",
    "auth/admin-restricted-operation": "Guest Mode is disabled in Firebase. Enable Anonymous under Authentication \u2192 Sign-in method.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
    "auth/too-many-requests": "Too many attempts. Please wait a minute and try again.",
    "auth/account-exists-with-different-credential": "This email is already linked to a different sign-in method.",
    "auth/api-key-not-valid": "Firebase rejected the API key. Check firebase-config.js and make sure the Identity Toolkit API is enabled.",
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase rejected the API key. Check firebase-config.js and make sure the Identity Toolkit API is enabled.",
    "auth/invalid-api-key": "Firebase rejected the API key. Check firebase-config.js.",
    "auth/configuration-not-found": "Firebase Authentication is not set up for this project yet. Open Authentication in the Firebase Console and enable a sign-in method."
};

function friendlyError(error) {
    if (!error) return "Something went wrong. Please try again.";
    if (error.code && ERROR_MESSAGES[error.code]) return ERROR_MESSAGES[error.code];
    return error.message || "Something went wrong. Please try again.";
}

function requireAuth() {
    if (!auth) {
        throw new Error("Firebase is not configured. Add your keys in firebase-config.js.");
    }
}

function wrapped(action) {
    return Promise.resolve()
        .then(function () {
            requireAuth();
            return action();
        })
        .catch(function (error) {
            throw new Error(friendlyError(error));
        });
}

function google() {
    return wrapped(function () {
        var provider = new GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        return signInWithPopup(auth, provider).then(function (result) {
            return result.user;
        });
    });
}

function emailLogin(email, password) {
    return wrapped(function () {
        return signInWithEmailAndPassword(auth, email, password).then(function (result) {
            return result.user;
        });
    });
}

function emailSignup(name, email, password) {
    return wrapped(function () {
        return createUserWithEmailAndPassword(auth, email, password).then(function (result) {
            var user = result.user;
            if (name) {
                return updateProfile(user, { displayName: name })
                    .catch(function () {})
                    .then(function () { return user; });
            }
            return user;
        });
    });
}

function guest() {
    return wrapped(function () {
        return signInAnonymously(auth).then(function (result) {
            return result.user;
        });
    });
}

function resetPassword(email) {
    return wrapped(function () {
        return sendPasswordResetEmail(auth, email);
    });
}

function logout() {
    if (!auth) return Promise.resolve();
    return signOut(auth).catch(function () {});
}

function onChange(callback) {
    if (!auth) {
        setTimeout(function () { callback(null); }, 0);
        return function () {};
    }
    return onAuthStateChanged(auth, callback);
}

window.BlissAuth = {
    isConfigured: Boolean(auth),
    configError: initError,
    onChange: onChange,
    google: google,
    emailLogin: emailLogin,
    emailSignup: emailSignup,
    guest: guest,
    resetPassword: resetPassword,
    logout: logout,
    currentUser: function () { return auth ? auth.currentUser : null; }
};
