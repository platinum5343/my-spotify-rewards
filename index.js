import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import admin from 'firebase-admin';

dotenv.config();

const serviceAccountJson = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(serviceAccountJson);

// Initialize Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const app = express();
app.use(cors());
app.use(express.json());

// === SPOTIFY CREDS ===
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;

// === STEP 1: REDIRECT TO SPOTIFY ===
app.get('/login', (req, res) => {
  const scope = 'user-read-email user-read-private';
  const authUrl = `https://accounts.spotify.com/authorize?client_id=${CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=${encodeURIComponent(scope)}&show_dialog=true`;
  res.redirect(authUrl);
});

// === STEP 2: SPOTIFY CALLBACK ===
app.get('/callback', async (req, res) => {
  const code = req.query.code;

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
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

    const tokenData = await tokenRes.json();
    console.log('Spotify token response:', tokenData);

    const access_token = tokenData.access_token;

    if (!access_token) {
      return res.status(401).json({
        error: 'Failed to get access token from Spotify',
        details: tokenData,
      });
    }

    // Use access token to fetch user profile
    const profileRes = await fetch('https://api.spotify.com/v1/me', {
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
    });

    const profile = await profileRes.json();
    console.log('Spotify profile:', profile);

    if (profile.error) {
      return res.status(401).json({
        error: 'Invalid access token when fetching profile',
        details: profile,
      });
    }

    const spotifyId = profile.id;
    const email = profile.email || 'Not provided';
    const displayName = profile.display_name || 'Unknown User';
    const imageUrl = (profile.images && profile.images.length > 0) ? profile.images[0].url : null;

    // Check if user already exists in Firestore
    const userRef = db.collection('users').doc(spotifyId);
    const userSnap = await userRef.get();

    let points;
    if (!userSnap.exists) {
      // New user: assign random points
      points = Math.floor(Math.random() * (15000 - 1000 + 1)) + 1000;

      await userRef.set({
        spotifyId,
        email,
        displayName,
        imageUrl,
        points,
        hasClaimed: false,
      });
    } else {
      // Existing user
      points = userSnap.data().points;
    }

    // Generate JWT token
    const token = jwt.sign({ id: spotifyId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Return profile + token
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

// === START SERVER ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
