/*
 * Firestore backend for Bliss Bloom Events.
 *
 * Stores RSVP bookings in the `rsvps` collection. When Firebase is not
 * configured (or Firestore cannot start) it falls back to localStorage so the
 * booking flow still works in demo mode.
 *
 *   BlissDB.isConfigured       -> true when Firestore is active
 *   BlissDB.addRsvp(data)      -> { id }
 *   BlissDB.listMyRsvps()      -> array of bookings for the current user
 */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
    getFirestore,
    collection,
    addDoc,
    query,
    where,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

var config = window.FIREBASE_CONFIG || {};
var configured = Boolean(
    config.apiKey &&
    config.projectId &&
    config.appId &&
    !/PASTE|YOUR_/i.test(config.apiKey + config.projectId + config.appId)
);

var db = null;

if (configured) {
    try {
        var app = getApps().length ? getApp() : initializeApp(config);
        db = getFirestore(app);
    } catch (error) {
        db = null;
    }
}

var LOCAL_KEY = "blissRsvps";
var MAX_LOCAL = 50;

function localId() {
    return "LOCAL-" + Date.now().toString(36).toUpperCase() + "-" +
        Math.random().toString(36).slice(2, 6).toUpperCase();
}

function readLocalUser() {
    try {
        return JSON.parse(localStorage.getItem("blissUser") || "null");
    } catch (e) {
        return null;
    }
}

function identity() {
    if (window.BlissAuth && window.BlissAuth.currentUser) {
        var authUser = window.BlissAuth.currentUser();
        if (authUser) {
            return {
                uid: authUser.uid,
                email: authUser.email || "",
                name: authUser.displayName || "",
                anonymous: !!authUser.isAnonymous
            };
        }
    }

    var local = readLocalUser();
    if (!local) {
        return { uid: "", email: "", name: "", anonymous: true };
    }

    return {
        uid: local.uid || ("local-" + (local.email || "guest")),
        email: local.email || "",
        name: local.name || "",
        anonymous: local.type === "guest" || !!local.isGuest
    };
}

function readLocalRsvps() {
    try {
        var list = JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]");
        return Array.isArray(list) ? list : [];
    } catch (e) {
        return [];
    }
}

function writeLocalRsvps(list) {
    try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(0, MAX_LOCAL)));
    } catch (e) {}
}

function toMillis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === "function") return value.toMillis();
    if (typeof value.seconds === "number") return value.seconds * 1000;
    var parsed = Date.parse(value);
    return isNaN(parsed) ? 0 : parsed;
}

function friendlyError(error) {
    var code = error && error.code;
    if (code === "permission-denied") {
        return "Firestore blocked this request. Check that the rules in firestore.rules are deployed.";
    }
    if (code === "unavailable") {
        return "The database is unreachable. Check your connection and try again.";
    }
    if (code === "failed-precondition") {
        return "Firestore is not ready. Create the database in the Firebase Console first.";
    }
    return (error && error.message) || "Could not save your RSVP. Please try again.";
}

async function addRsvp(data) {
    var who = identity();
    var now = new Date().toISOString();
    var record = {
        name: data.name || "",
        email: data.email || "",
        guests: Number(data.guests) || 0,
        itemsSummary: data.itemsSummary || "",
        items: data.items || [],
        totalCost: Number(data.totalCost) || 0,
        advancePayment: Number(data.advancePayment) || 0,
        userId: who.uid,
        userEmail: who.email,
        userName: who.name,
        anonymous: who.anonymous,
        status: "pending",
        clientCreatedAt: now
    };

    if (db) {
        try {
            var ref = await addDoc(collection(db, "rsvps"), Object.assign({}, record, {
                createdAt: serverTimestamp()
            }));
            return { id: ref.id, local: false };
        } catch (error) {
            throw new Error(friendlyError(error));
        }
    }

    var id = localId();
    var list = readLocalRsvps();
    list.unshift(Object.assign({ id: id, createdAt: now }, record));
    writeLocalRsvps(list);
    return { id: id, local: true };
}

async function listMyRsvps() {
    var who = identity();

    if (db) {
        if (!who.uid) return [];
        try {
            var ref = query(collection(db, "rsvps"), where("userId", "==", who.uid));
            var snapshot = await getDocs(ref);
            var rows = snapshot.docs.map(function (doc) {
                var value = doc.data();
                value.id = doc.id;
                return value;
            });
            rows.sort(function (a, b) {
                return toMillis(b.createdAt || b.clientCreatedAt) -
                    toMillis(a.createdAt || a.clientCreatedAt);
            });
            return rows;
        } catch (error) {
            throw new Error(friendlyError(error));
        }
    }

    var localRows = readLocalRsvps().filter(function (row) {
        if (who.email) {
            return (row.userEmail || row.email || "").toLowerCase() === who.email.toLowerCase();
        }
        return (row.userId || "") === who.uid;
    });

    localRows.sort(function (a, b) {
        return toMillis(b.createdAt) - toMillis(a.createdAt);
    });
    return localRows;
}

window.BlissDB = {
    isConfigured: Boolean(db),
    identity: identity,
    addRsvp: addRsvp,
    listMyRsvps: listMyRsvps
};
