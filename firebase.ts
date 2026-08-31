import { getAnalytics } from "firebase/analytics";
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDFr8Oe0li1TitBdk691gjzCd2Aa3eO3rs",
  authDomain: "kalandor-7d365.firebaseapp.com",
  projectId: "kalandor-7d365",
  storageBucket: "kalandor-7d365.firebasestorage.app",
  messagingSenderId: "844883870713",
  appId: "1:844883870713:web:dabf13761f4df7f50b7328",
  measurementId: "G-42WCTQP3CK",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const analytics =
  typeof window !== "undefined" && typeof document !== "undefined"
    ? getAnalytics(app)
    : null;
