'use strict';

// Dry run by default. Run --apply only after checking its report and backing up
// the live project. This prepares existing identities before restrictive rules.
const fs = require('node:fs/promises');
const path = require('node:path');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const projectId = process.env.FIREBASE_PROJECT_ID;
const apply = process.argv.includes('--apply');
const uids = (name) => (process.env[name] || '').split(',').map(x => x.trim()).filter(Boolean);
const adminUids = uids('PHOTO_ADMIN_UIDS');
const posUids = uids('PHOTO_ALLOWED_POS_UIDS');
const phoneEmail = (phone) => {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^5\d{9}$/.test(digits) ? `${digits}@okul.local` : null;
};

function selectParents(docs) {
  const groups = new Map();
  const excluded = [];
  const problems = [];
  for (const item of docs) {
    const data = item.data();
    const email = phoneEmail(data.telefonNo);
    if (!email) {
      (data.authID ? problems : excluded).push(`Geçersiz veli telefonu: ${item.id}`);
      continue;
    }
    if (!groups.has(email)) groups.set(email, []);
    groups.get(email).push({ item, email });
  }
  const eligible = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      eligible.push(group[0]);
      continue;
    }
    const ids = group.map(({ item }) => item.id).join(', ');
    (group.some(({ item }) => item.data().authID) ? problems : excluded)
      .push(`Aynı telefona bağlı veliler: ${ids}`);
  }
  return { eligible, excluded, problems };
}

async function main() {
  if (projectId !== 'okul-otomat-projesi' || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Doğru FIREBASE_PROJECT_ID ve GOOGLE_APPLICATION_CREDENTIALS gerekli.');
  }
  if (apply && (!path.isAbsolute(process.env.PHOTO_DATA_DIR || '') ||
                adminUids.length === 0 || posUids.length === 0)) {
    throw new Error('Uygulama için PHOTO_DATA_DIR, PHOTO_ADMIN_UIDS ve PHOTO_ALLOWED_POS_UIDS gerekli.');
  }
  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();
  const auth = getAuth();
  const parents = await db.collection('veliler').get();
  const linkedOwners = new Map();
  const parentUpdates = [];
  const linkCreates = [];
  const selection = selectParents(parents.docs);
  const problems = [...selection.problems];

  for (const { item, email } of selection.eligible) {
    const data = item.data();
    if (data.authEmail !== email) parentUpdates.push({ ref: item.ref, old: data.authEmail, email });
    if (data.authID) {
      if (linkedOwners.has(data.authID) && linkedOwners.get(data.authID) !== item.id) {
        problems.push(`Bir Auth UID için birden fazla veli: ${item.id}`);
        continue;
      }
      linkedOwners.set(data.authID, item.id);
      try {
        const user = await auth.getUser(data.authID);
        if (user.email !== email) problems.push(`Auth e-posta uyuşmazlığı: ${item.id}`);
      } catch (error) {
        problems.push(`Bağlı Auth kullanıcısı bulunamadı: ${item.id} (${error.code})`);
      }
      const linkRef = db.collection('parent_auth').doc(data.authID);
      const link = await linkRef.get();
      if (link.exists && link.data().veliId !== item.id) {
        problems.push(`Veli bağlantısı çakışıyor: ${item.id}`);
      } else if (!link.exists) {
        linkCreates.push({ ref: linkRef, veliId: item.id });
      }
    }
  }

  const admins = [];
  for (const uid of adminUids) {
    const parentId = linkedOwners.get(uid);
    const parent = parentId && parents.docs.find(item => item.id === parentId);
    if (!parent || parent.data().role !== 'admin' || parent.data().aktif === false) {
      problems.push(`Yönetici rolü doğrulanamadı: ${uid}`);
      continue;
    }
    const user = await auth.getUser(uid);
    admins.push({ uid, originalClaims: user.customClaims || {} });
  }

  const posRecords = [];
  for (const uid of posUids) {
    const user = await auth.getUser(uid);
    const sale = await db.collection('satislar').where('posUid', '==', uid).limit(1).get();
    if (user.email || user.providerData.length !== 0 || sale.empty) {
      problems.push(`POS hesabı/satış eşleşmesi doğrulanamadı: ${uid}`);
      continue;
    }
    const ref = db.collection('pos_cihazlari').doc(uid);
    const old = await ref.get();
    posRecords.push({ ref, old: old.exists ? old.data() : null });
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    parents: parents.size,
    eligibleParents: selection.eligible.length,
    excludedParents: parents.size - selection.eligible.length,
    authEmailUpdates: parentUpdates.length,
    parentAuthCreates: linkCreates.length,
    admins: admins.map(item => item.uid),
    posUids,
    excluded: selection.excluded,
    problems,
  }, null, 2));
  if (problems.length) throw new Error('Çakışmalar var; canlı kayıtlar düzeltilmeden geçiş yapılamaz.');
  if (!apply) return;

  await fs.mkdir(process.env.PHOTO_DATA_DIR, { recursive: true });
  const backup = path.join(process.env.PHOTO_DATA_DIR,
    `firestore-access-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await fs.writeFile(backup, JSON.stringify({
    projectId,
    excluded: selection.excluded,
    parentUpdates: parentUpdates.map(item => ({ id: item.ref.id, old: item.old ?? null,
      hadField: item.old !== undefined })),
    parentAuthCreates: linkCreates.map(item => item.ref.id),
    admins,
    posRecords: posRecords.map(item => ({ uid: item.ref.id, old: item.old })),
  }, null, 2), { flag: 'wx', mode: 0o600 });

  const writes = [
    ...parentUpdates.map(item => ({ ref: item.ref, data: { authEmail: item.email }, merge: true })),
    ...linkCreates.map(item => ({ ref: item.ref, data: { veliId: item.veliId }, merge: false })),
    ...posRecords.map(item => ({ ref: item.ref, data: { aktif: true }, merge: true })),
  ];
  for (let i = 0; i < writes.length; i += 200) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + 200)) {
      batch.set(write.ref, write.data, { merge: write.merge });
    }
    await batch.commit();
  }
  for (const admin of admins) {
    await auth.setCustomUserClaims(admin.uid, { ...admin.originalClaims, admin: true });
  }
  console.log(`Hazırlık tamamlandı. Yerel geri dönüş kaydı: ${backup}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { phoneEmail, selectParents };
