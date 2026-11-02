# final-year-project

## Bliss Bloom Events — Firebase login setup

The site is static (`ss/`). Sign-in uses Firebase Authentication when configured,
and falls back to a local demo login until then.

### 1. Create the Firebase app
1. Create a project at <https://console.firebase.google.com>.
2. Go to **Project settings → Your apps → Web app (`</>`)** and register the site.
3. Copy the `firebaseConfig` object.

### 2. Add the keys
Open `ss/firebase-config.js` and replace the `PASTE_...` values with your config:

```js
window.FIREBASE_CONFIG = {
    apiKey: "...",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project",
    storageBucket: "your-project.appspot.com",
    messagingSenderId: "...",
    appId: "..."
};
```

### 3. Enable sign-in methods
Firebase Console → **Authentication → Sign-in method**:
- **Google** — enable it (this powers “Sign in with Google”).
- **Email/Password** — enable it for the email login and sign-up form.
- **Anonymous** — enable it if you want Guest Mode to create a real guest session.

### 4. Authorise the domain
Firebase Console → **Authentication → Settings → Authorized domains**:
- `localhost` (already listed by default)
- your deployed domain, e.g. `your-name.github.io`

### 5. Run locally
```powershell
cd ss
py -m http.server 8000
```
Open <http://localhost:8000/splash.html>.

### Behaviour
- Without real keys the login page shows **Demo mode** and uses `localStorage`.
- With real keys, `ss/auth.js` uses `signInWithPopup` + `onAuthStateChanged`;
  `web.html` verifies the Firebase session instead of trusting `localStorage`.
- Password reset, Google account switching, guest sessions and sign-out go
  through Firebase once it is configured.
