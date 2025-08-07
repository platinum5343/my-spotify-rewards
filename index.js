import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import admin from 'firebase-admin';

const serviceAccountJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(serviceAccountJson);



dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// === FIREBASE SETUP ===
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// === SPOTIFY CREDS ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

// STEP 1: Redirect to Spotify
app.get('/login', (req, res) => {
  const scope = 'user-read-email user-read-private';
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&show_dialog=true`;
  res.redirect(authUrl);
});

// STEP 2: Spotify callback
app.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for access token
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });

    const data = await response.json();
    const access_token = data.access_token;

    // Fetch Spotify profile
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const profile = await profileRes.json();
    console.log('Spotify profile:', profile);

    const spotifyId = profile.id;
    const email = profile.email || 'Not provided';
    const displayName = profile.display_name || 'Unknown User';
    const imageUrl = (profile.images && profile.images.length > 0) ? profile.images[0].url : null;

    // Check if user exists in Firebase
    const userRef = doc(db, 'users', spotifyId);
    const userSnap = await getDoc(userRef);

    let points;
    if (!userSnap.exists()) {
      // New user: assign random points and save to Firebase
      points = Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000;
      await setDoc(userRef, {
        spotifyId,
        email,
        displayName,
        imageUrl,
        points,
        hasClaimed: false,
      });
    } else {
      // Existing user: get points from DB
      points = userSnap.data().points;
    }

    // JWT Token
    const token = jwt.sign({ id: spotifyId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Return profile and token
    res.json({
      profile: {
        name: displayName,
        email,
        image: imageUrl,
        points,
      },
      token,
    });
  } catch (err) {
    console.error('Error during Spotify auth flow:', err);
    res.status(500).json({ error: 'Something went wrong during Spotify login.' });
  }
});

// Run the server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
