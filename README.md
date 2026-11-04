# final-year-project

## Bliss Bloom Events — Firebase setup

The site is static (`ss/`). Sign-in uses Firebase Authentication and RSVPs are
stored in Cloud Firestore when configured; both fall back to `localStorage`
demo mode until then.

> **Current project:** `bliss-and-blooms`. The web config is already filled in.
> Enable **Authentication** and create **Firestore** as described below before
> real sign-in and RSVP storage will work.

### 1. Create the Firebase app
1. Create a project at <https://console.firebase.google.com>.
2. Go to **Project settings → Your apps → Web app (`</>`)** and register the site.
3. Copy the `firebaseConfig` object.

### 2. Add the keys
`ss/firebase-config.js` is already configured for the **bliss-and-blooms**
project. To use a different Firebase project, replace it with that project's
config:

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

### 4. Create the Firestore database
Firebase Console → **Build → Firestore Database → Create database**:
1. Choose **Production mode** (rules are provided in `firestore.rules`).
2. Pick the region closest to you (e.g. `asia-south1` for India).
3. After it is created, open the **Rules** tab, paste the contents of
   `firestore.rules`, and click **Publish**.
   - You can also deploy them from the repo:
     ```powershell
     npm install -g firebase-tools
     firebase login
     firebase use --add        # pick your project
     firebase deploy --only firestore:rules
     ```

Bookings are written to the `rsvps` collection. Each document stores the guest
name/email, guest count, selected dishes/decor, totals, advance payment, the
Firebase `userId`, and a `createdAt` server timestamp. Users can only read
their own bookings.

### 5. Authorise the domain
Firebase Console → **Authentication → Settings → Authorized domains**:
- `localhost` (already listed by default)
- your deployed domain, e.g. `your-name.github.io` or `your-project.web.app`

### 6. Run locally
```powershell
cd ss
py -m http.server 8000
```
Open <http://localhost:8000/splash.html>.

### Behaviour
- Without real keys the login page shows **Demo mode**: auth and bookings use
  `localStorage`, and the account menu’s **My Bookings** reads local entries.
- With real keys:
  - `ss/auth.js` uses `signInWithPopup` + `onAuthStateChanged`; `web.html`
    verifies the Firebase session instead of trusting `localStorage`.
  - `ss/db.js` saves each RSVP to Firestore and **My Bookings** lists the
    signed-in user’s bookings (works for anonymous guests too).
- Password reset, Google account switching, guest sessions and sign-out go
  through Firebase once it is configured.

### Optional: Firebase Hosting
`firebase.json` is already configured to publish the `ss/` folder:

```powershell
firebase login
firebase use --add
firebase deploy --only hosting
```

The site is then served from `https://your-project.web.app`, with `/` opening
the splash screen. Remember to add that domain under **Authorized domains**.
