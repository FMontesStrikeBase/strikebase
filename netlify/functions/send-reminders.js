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
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

if (!getApps().length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  initializeApp({
    credential: cert(serviceAccount),
  });
}

const db = getFirestore();
const messaging = getMessaging();

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
    const fcmTokens = userSnap.data()?.fcmTokens || [];
    if (!fcmTokens.length) continue;

    let enviadoAlMenosUnaVez = false;
    const tokensInvalidos = [];

    for (const token of fcmTokens) {
      try {
        await messaging.send({
          token,
          notification: {
            title: 'StrikeBase',
            body: `Es hora de: ${habit.name}`,
          },
          data: { habitId: habitDoc.id },
        });
        enviadoAlMenosUnaVez = true;
      } catch (err) {
        // Token inválido/expirado (dispositivo desinstaló la app, etc.) — se limpia más abajo
        console.error(`Error enviando a un token de ${habitDoc.id}:`, err.message);
        if (err.code === 'messaging/registration-token-not-registered') {
          tokensInvalidos.push(token);
        }
      }
    }

    if (tokensInvalidos.length) {
      const tokensLimpios = fcmTokens.filter((t) => !tokensInvalidos.includes(t));
      await userRef.update({ fcmTokens: tokensLimpios });
    }

    if (enviadoAlMenosUnaVez) {
      await habitDoc.ref.update({ ultimoRecordatorioEnviado: hoyKey });
      enviados++;
    }
  }

  console.log(`Recordatorios enviados: ${enviados}`);
  return { statusCode: 200, body: JSON.stringify({ enviados }) };
};

exports.handler = schedule('*/15 * * * *', handler);
