/**
 * Firebase setup (Auth + Cloud Firestore, modular SDK v10 from the CDN).
 *
 * 1. Create a project at https://console.firebase.google.com
 * 2. Enable Authentication > Email/Password and create a Firestore database.
 * 3. Paste your web app config below.
 * 4. Use these Firestore rules so each user can only touch their own data:
 *
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{db}/documents {
 *        match /users/{userId}/{document=**} {
 *          allow read, write: if request.auth != null && request.auth.uid == userId;
 *        }
 *      }
 *    }
 *
 * Until real keys are added, the app runs in demo mode using localStorage.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Re-export the SDK functions app.js needs so it has a single import point.
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
export * from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

export const isConfigured = !firebaseConfig.apiKey.startsWith("YOUR_");

export let auth = null;
export let db = null;

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app); // session persistence is on by default (IndexedDB)
    db = getFirestore(app);
  } catch (err) {
    console.error("Firebase failed to initialize:", err);
  }
}
