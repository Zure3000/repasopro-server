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

// ── WEB PUSH VAPID KEYS ──
webpush.setVapidDetails(
  'mailto:admin@repasopro.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── GUARDAR SUSCRIPCIÓN ──
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

// ── ESCUCHAR FIREBASE Y ENVIAR PUSH AUTOMÁTICAMENTE ──
let lastProcessedTs = 0;

db.ref('last_push').on('value', async snap => {
  if (!snap || !snap.exists()) return;
  const data = snap.val();
  if (!data || !data.ts) return;
  if (data.ts <= lastProcessedTs) return;
  lastProcessedTs = data.ts;

  const { title, body, autor, groupCode } = data;
  console.log(`Nuevo examen detectado: "${title}" por ${autor} (grupo: ${groupCode})`);

  try {
    const subsSnap = await db.ref('push_subscriptions').once('value');
    if (!subsSnap.exists()) return;
    const payload = JSON.stringify({ title: title || '📚 RepasoPro', body: body || 'Nuevo examen publicado' });
    const promises = [];
    subsSnap.forEach(child => {
      const d = child.val();
      if (d.username === autor) return; // no notificar al autor
      if (groupCode && d.groupCode !== groupCode) return; // solo mismo grupo
      promises.push(
        webpush.sendNotification(d.subscription, payload).catch(err => {
          if (err.statusCode === 410) db.ref(`push_subscriptions/${d.username}`).remove();
        })
      );
    });
    await Promise.all(promises);
    console.log(`✅ Notificacion enviada a ${promises.length} usuarios`);
  } catch (e) {
    console.error('Error enviando notificacion:', e.message);
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
    yesterday.setDate(yesterday.getDate() - 2);
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
