const express = require('express');
const webpush = require('web-push');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();
app.use(cors());
app.use(express.json());
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount), databaseURL: 'https://repasopro-97e9b-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();
webpush.setVapidDetails('mailto:admin@repasopro.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
app.post('/subscribe', async (req, res) => {
  const { username, subscription, groupCode } = req.body;
  if (!username || !subscription) return res.status(400).json({ error: 'Faltan datos' });
  try { await db.ref('push_subscriptions/'+username).set({ subscription, username, groupCode: groupCode||'' }); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
let lastProcessedTs = 0;
db.ref('last_push').on('value', async snap => {
  if (!snap||!snap.exists()) return;
  const data = snap.val();
  if (!data||!data.ts||data.ts<=lastProcessedTs) return;
  lastProcessedTs = data.ts;
  const { title, body, autor, groupCode } = data;
  console.log('Nuevo examen: '+title+' por '+autor);
  try {
    const subsSnap = await db.ref('push_subscriptions').once('value');
    if (!subsSnap.exists()) return;
    const payload = JSON.stringify({ title: title||'📚 RepasoPro', body: body||'Nuevo examen' });
    const promises = [];
    subsSnap.forEach(child => {
      const d = child.val();
      if (d.username===autor) return;
      if (groupCode && d.groupCode!==groupCode) return;
      promises.push(webpush.sendNotification(d.subscription, payload).catch(err => { if(err.statusCode===410) db.ref('push_subscriptions/'+d.username).remove(); }));
    });
    await Promise.all(promises);
    console.log('Enviado a '+promises.length+' usuarios');
  } catch(e) { console.error('Error:', e.message); }
});
app.get('/vapid-public-key', (req, res) => { res.json({ key: process.env.VAPID_PUBLIC_KEY }); });
app.get('/', (req, res) => res.json({ status: 'RepasoPro server running ✅' }));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server running on port '+PORT));
