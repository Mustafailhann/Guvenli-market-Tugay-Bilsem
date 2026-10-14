'use strict';

const http = require('node:http');
const path = require('node:path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createHandler } = require('./server');
const { viewerCanAccessStudent } = require('./authorization');

const dataDir = process.env.PHOTO_DATA_DIR;
const allowedPosUids = new Set((process.env.PHOTO_ALLOWED_POS_UIDS || '')
  .split(',').map((uid) => uid.trim()).filter(Boolean));
if (!dataDir || !path.isAbsolute(dataDir)) {
  throw new Error('PHOTO_DATA_DIR mutlak bir klasör yolu olmalı.');
}
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS gerekli.');
}
if (allowedPosUids.size === 0) {
  throw new Error('PHOTO_ALLOWED_POS_UIDS en az bir kayıtlı POS UID içermeli.');
}

initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID || 'okul-otomat-projesi',
});
const db = getFirestore();

async function getSale(saleId) {
  const snapshot = await db.collection('satislar').doc(saleId).get();
  return snapshot.exists ? snapshot.data() : null;
}

async function getViewer(uid) {
  const direct = await db.collection('veliler').doc(uid).get();
  if (direct.exists && direct.data().authID === uid) {
    return { id: direct.id, ...direct.data() };
  }
  const linked = await db.collection('veliler').where('authID', '==', uid).limit(2).get();
  if (linked.size !== 1) return null;
  return { id: linked.docs[0].id, ...linked.docs[0].data() };
}

async function canView(actor, sale) {
  const viewer = await getViewer(actor.uid);
  if (!viewer || viewer.aktif === false) return false;
  if (viewer.role === 'admin' && actor.admin === true) return true;
  if (!sale.ogrenciId) return false;
  const student = await db.collection('ogrenciler').doc(sale.ogrenciId).get();
  if (!student.exists) return false;
  const data = student.data();
  if (Array.isArray(data.veliIDleri) && data.veliIDleri.includes(viewer.id)) return true;
  const requests = await db.collection('cocukTalepleri')
    .where('veliID', '==', viewer.id).get();
  return viewerCanAccessStudent(viewer, data, sale,
    requests.docs.map((item) => item.data()), actor);
}

const handler = createHandler({
  verifyToken: (token) => getAuth().verifyIdToken(token, true),
  getSale,
  canView,
  allowedPosUids,
  dataDir,
});

http.createServer(handler).listen(8787, '127.0.0.1', () => {
  console.log('Fotoğraf sunucusu 127.0.0.1:8787 üzerinde hazır.');
});
