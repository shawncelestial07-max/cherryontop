import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyC4s4n2JUWYJrAJB6hYLY0aEN4ci90_4O0",
  authDomain: "cherryontop-sari-sari-store.firebaseapp.com",
  projectId: "cherryontop-sari-sari-store",
  storageBucket: "cherryontop-sari-sari-store.firebasestorage.app",
  messagingSenderId: "953027514712",
  appId: "1:953027514712:web:39599632bfe7a8cfb8d52d"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { db, auth };
