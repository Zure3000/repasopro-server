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

// ── GUARDAR SUSCRIPCIÓN (una por usuario, con groupCode) ──
app.post('/subscribe', async (req, res) => {
  const { username, subscription, groupCode } = req.body;
  if (!username || !subscription) return res.status(400).json({ error: 'Faltan datos' });
  try {
    await db.ref(`push_subscriptions/${username}`).set({ subscription, username, groupCode: groupCode || '' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Control de notificaciones ya enviadas (evita duplicados)
const sentNotifications = new Map();

// ── ENVIAR NOTIFICACIÓN (filtrado por grupo, sin duplicados) ──
app.post('/notify', async (req, res) => {
  const { title, body, autorUsername, groupCode, notifId } = req.body;
  if (!title) return res.status(400).json({ error: 'Falta título' });

  // Si ya procesamos esta notificación exacta, ignorar
  const key = notifId || (title + autorUsername + groupCode);
  if (sentNotifications.has(key)) {
    return res.json({ sent: 0, skipped: true });
  }
  sentNotifications.set(key, Date.now());
  // Limpiar entradas antiguas (más de 1 hora)
  const hour = 60 * 60 * 1000;
  sentNotifications.forEach((ts, k) => { if (Date.now() - ts > hour) sentNotifications.delete(k); });

  try {
    const snap = await db.ref('push_subscriptions').once('value');
    if (!snap.exists()) return res.json({ sent: 0 });
    const payload = JSON.stringify({ title, body });
    const promises = [];
    snap.forEach(child => {
      const data = child.val();
      if (data.username === autorUsername) return; // no notificar al autor
      if (groupCode && data.groupCode !== groupCode) return; // solo mismo grupo
      const sub = data.subscription;
      promises.push(
        webpush.sendNotification(sub, payload).catch(err => {
          if (err.statusCode === 410) {
            db.ref(`push_subscriptions/${data.username}`).remove();
          }
        })
      );
    });
    await Promise.all(promises);
    console.log(`Notificacion enviada: "${title}" → ${promises.length} usuarios`);
    res.json({ sent: promises.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DEVOLVER VAPID PUBLIC KEY ──
app.get('/vapid-public-key', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

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
    if (deletions.length > 0) console.log(`${deletions.length} examenes eliminados`);
  } catch (e) {
    console.error('Error limpiando examenes:', e.message);
  }
}

cleanOldExams();
setInterval(cleanOldExams, 24 * 60 * 60 * 1000);

app.get('/', (req, res) => res.json({ status: 'RepasoPro server running ✅' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
