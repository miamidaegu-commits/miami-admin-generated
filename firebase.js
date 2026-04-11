// src/lib/firebase.js
// Replace the firebaseConfig values with your own Firebase project credentials.
// You can find these in Firebase Console → Project Settings → Your Apps → SDK setup.

import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getFunctions } from 'firebase/functions'

const firebaseConfig = {
  apiKey: "AIzaSyDgF4BT9KnyRpApMY23ScZgbBMSmu-ExuU",
  authDomain: "miamiacademyschedule.firebaseapp.com",
  projectId: "miamiacademyschedule",
  storageBucket: "miamiacademyschedule.firebasestorage.app",
  messagingSenderId: "1086077006833",
  appId: "1:1086077006833:web:344e89ad2f30b5c0b44a50"
};


const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const functions = getFunctions(app, 'us-central1')
