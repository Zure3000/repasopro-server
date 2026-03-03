const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ── FIREBASE ADMIN ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: 'https://repasopro-97e9b-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();

// ── WEB PUSH VAPID KEYS ──
webpush.setVapidDetails(
  'mailto:admin@repasopro.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── GUARDAR SUSCRIPCIÓN DE USUARIO ──
app.post('/subscribe', async (req, res) => {
  const { username, subscription } = req.body;
  if (!username || !subscription) return res.status(400).json({ error: 'Faltan datos' });
  try {
    await db.ref(`push_subscriptions/${username}`).set({ subscription, username });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ENVIAR NOTIFICACIÓN A TODOS ──
app.post('/notify', async (req, res) => {
  const { title, body, autorUsername } = req.body;
  if (!title) return res.status(400).json({ error: 'Falta título' });
  try {
    const snap = await db.ref('push_subscriptions').once('value');
    if (!snap.exists()) return res.json({ sent: 0 });
    const payload = JSON.stringify({ title, body });
    const promises = [];
    snap.forEach(child => {
      const data = child.val();
      if (data.username === autorUsername) return; // no notificar al autor
      const sub = data.subscription;
      promises.push(
        webpush.sendNotification(sub, payload).catch(err => {
          // Si la suscripción ya no es válida, la eliminamos
          if (err.statusCode === 410) {
            db.ref(`push_subscriptions/${data.username}`).remove();
          }
        })
      );
    });
    await Promise.all(promises);
    res.json({ sent: promises.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DEVOLVER VAPID PUBLIC KEY ──
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

app.get('/', (req, res) => res.json({ status: 'RepasoPro server running ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
