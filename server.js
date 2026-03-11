const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
app.use(cors());
app.use(express.json());

// ── FIREBASE ADMIN ──
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://repasopro-97e9b-default-rtdb.europe-west1.firebasedatabase.app'
});
const db = admin.database();

// ── VAPID ──
webpush.setVapidDetails(
  'mailto:admin@repasopro.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── GUARDAR SUSCRIPCIÓN ──
app.post('/subscribe', async (req, res) => {
  const { username, subscription, groupCode, curso } = req.body;
  if (!username || !subscription) return res.status(400).json({ error: 'Faltan datos' });
  try {
    await db.ref(`push_subscriptions/${username}`).set({
      subscription, username,
      groupCode: groupCode || '',
      curso: curso || '',
      updatedAt: Date.now()
    });
    console.log(`[sub] ${username} registrado`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── ENVIAR PUSH A UN USUARIO CONCRETO ──
// La app llama a este endpoint cuando quiere notificar a alguien específico
app.post('/send-to-user', async (req, res) => {
  const { username, title, body } = req.body;
  if (!username || !title) return res.status(400).json({ error: 'Faltan datos' });
  try {
    const snap = await db.ref(`push_subscriptions/${username}`).once('value');
    if (!snap.exists()) return res.json({ ok: false, reason: 'Sin suscripción' });
    const d = snap.val();
    const payload = JSON.stringify({ title, body: body || '' });
    await webpush.sendNotification(d.subscription, payload).catch(async err => {
      if (err.statusCode === 410 || err.statusCode === 404) {
        // Suscripción caducada, borrar
        await db.ref(`push_subscriptions/${username}`).remove();
        console.log(`[push] suscripción caducada de ${username}, eliminada`);
      }
    });
    console.log(`[push] enviado a ${username}: ${title}`);
    res.json({ ok: true });
  } catch (e) {
    console.error('[push] error send-to-user:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── VAPID PUBLIC KEY ──
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

// ── HEALTH CHECK (para UptimeRobot) ──
app.get('/', (req, res) => res.json({ status: 'RepasoPro server running ✅', ts: Date.now() }));

// ── LIMPIEZA AUTOMÁTICA DE EXÁMENES PASADOS ──
async function cleanOldExams() {
  try {
    const snap = await db.ref('exams').once('value');
    if (!snap.exists()) return;
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = yesterday.toISOString().split('T')[0];
    const deletions = [];
    snap.forEach(child => {
      const exam = child.val();
      if (exam.fecha && exam.fecha < cutoff) {
        deletions.push(db.ref(`exams/${child.key}`).remove());
      }
    });
    await Promise.all(deletions);
    if (deletions.length > 0) console.log(`[clean] ${deletions.length} exámenes eliminados`);
  } catch (e) {
    console.error('[clean] error:', e.message);
  }
}
cleanOldExams();
setInterval(cleanOldExams, 24 * 60 * 60 * 1000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`RepasoPro server en puerto ${PORT}`));
