// StrikeBase — Recordatorios de hábitos (Fase 2 PWA)
//
// Corre cada 15 minutos. Revisa todos los hábitos de todos los usuarios
// (colección "habits" a través de collectionGroup) que tengan recordatorio
// activado, y envía una notificación push si su horario cae dentro de la
// ventana de los últimos 15 minutos y todavía no se envió hoy.
//
// Requiere la variable de entorno FIREBASE_SERVICE_ACCOUNT en Netlify,
// con el contenido completo del JSON de la cuenta de servicio de Firebase.

const { schedule } = require('@netlify/functions');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

const DAY_ABBR = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']; // igual que en app.html

function horaLimaAhora() {
  // Servidor corre en UTC — convertimos explícitamente a hora de Lima (UTC-5, sin horario de verano)
  const ahoraUTC = new Date();
  const limaMs = ahoraUTC.getTime() - 5 * 60 * 60 * 1000;
  return new Date(limaMs);
}

function minutosDesdeMedianoche(fecha) {
  return fecha.getUTCHours() * 60 + fecha.getUTCMinutes();
}

function dayKeyOf(fecha) {
  return `${fecha.getUTCFullYear()}-${fecha.getUTCMonth() + 1}-${fecha.getUTCDate()}`;
}

function estaProgramadoHoy(habit, fecha) {
  if (habit.frecuencia !== 'personalizada') return true;
  return (habit.dias || []).includes(DAY_ABBR[fecha.getUTCDay()]);
}

const handler = async function () {
  const ahora = horaLimaAhora();
  const minutosAhora = minutosDesdeMedianoche(ahora);
  const hoyKey = dayKeyOf(ahora);

  const habitsSnap = await db
    .collectionGroup('habits')
    .where('recordatorioActivado', '==', true)
    .get();

  let enviados = 0;

  for (const habitDoc of habitsSnap.docs) {
    const habit = habitDoc.data();
    if (!habit.horario || habit.estado === 'retirado') continue;
    if (habit.ultimoRecordatorioEnviado === hoyKey) continue; // ya se envió hoy
    if (!estaProgramadoHoy(habit, ahora)) continue;

    const [hh, mm] = habit.horario.split(':').map(Number);
    const minutosHabito = hh * 60 + mm;

    // ¿el horario del hábito cae dentro de los últimos 15 minutos?
    const dentroDeVentana = minutosHabito <= minutosAhora && minutosHabito > minutosAhora - 15;
    if (!dentroDeVentana) continue;

    // El documento del hábito vive en users/{uid}/habits/{habitId}
    const userRef = habitDoc.ref.parent.parent;
    const userSnap = await userRef.get();
    const fcmToken = userSnap.data()?.fcmToken;
    if (!fcmToken) continue;

    try {
      await admin.messaging().send({
        token: fcmToken,
        notification: {
          title: 'StrikeBase',
          body: `Es hora de: ${habit.name}`,
        },
        data: { habitId: habitDoc.id },
      });
      await habitDoc.ref.update({ ultimoRecordatorioEnviado: hoyKey });
      enviados++;
    } catch (err) {
      // Token inválido o expirado — no detiene el resto del batch
      console.error(`Error enviando a ${habitDoc.id}:`, err.message);
    }
  }

  console.log(`Recordatorios enviados: ${enviados}`);
  return { statusCode: 200, body: JSON.stringify({ enviados }) };
};

exports.handler = schedule('*/15 * * * *', handler);
