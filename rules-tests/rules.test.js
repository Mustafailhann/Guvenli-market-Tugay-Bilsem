'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');
require('firebase/compat/firestore');

const collection = (db, name) => db.collection(name);
const doc = (db, ...parts) => db.doc(parts.join('/'));
const getDoc = ref => ref.get();
const getDocs = ref => ref.get();
const setDoc = (ref, data) => ref.set(data);
const updateDoc = (ref, data) => ref.update(data);
const where = (field, op, value) => ({ field, op, value });
const query = (ref, ...clauses) => clauses.reduce(
  (current, clause) => current.where(clause.field, clause.op, clause.value), ref);

test('canlı erişim kuralları veli, yönetici ve POS yetkilerini ayırır', async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-photo-rules',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
  });
  try {
    await env.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, 'veliler', 'parent-1'), {
        veliID: 'parent-1', authID: 'uid-parent', authEmail: '5512345678@okul.local',
        telefonNo: '5512345678', aktif: true, role: 'veli',
      });
      await setDoc(doc(db, 'veliler', 'parent-unclaimed'), {
        veliID: 'parent-unclaimed', authEmail: '5599999999@okul.local',
        telefonNo: '5599999999', aktif: true,
      });
      await setDoc(doc(db, 'veliler', 'admin-1'), {
        veliID: 'admin-1', authID: 'uid-admin', authEmail: '5550000000@okul.local',
        telefonNo: '5550000000', aktif: true, role: 'admin',
      });
      await setDoc(doc(db, 'veliler', 'parent-inactive'), {
        veliID: 'parent-inactive', authID: 'uid-inactive',
        authEmail: '5588888888@okul.local', telefonNo: '5588888888', aktif: false,
      });
      await setDoc(doc(db, 'parent_auth', 'uid-parent'), { veliId: 'parent-1' });
      await setDoc(doc(db, 'parent_auth', 'uid-inactive'), { veliId: 'parent-inactive' });
      await setDoc(doc(db, 'pos_cihazlari', 'uid-pos'), { aktif: true });
      await setDoc(doc(db, 'ogrenciler', 'student-1'), {
        veliIDleri: ['parent-1', 'parent-unclaimed', 'parent-inactive'], bakiye: 50,
        islemGecmisi: [],
      });
      await setDoc(doc(db, 'ogrenciler', 'student-2'), {
        veliIDleri: ['someone-else'], bakiye: 10, islemGecmisi: [],
      });
      await setDoc(doc(db, 'urunler', 'product-1'), { stok: 5 });
    });

    const anonymous = env.unauthenticatedContext().firestore();
    const parent = env.authenticatedContext('uid-parent',
      { email: '5512345678@okul.local' }).firestore();
    const stranger = env.authenticatedContext('uid-stranger',
      { email: '5500000000@okul.local' }).firestore();
    const newParent = env.authenticatedContext('uid-new',
      { email: '5599999999@okul.local' }).firestore();
    const inactive = env.authenticatedContext('uid-inactive',
      { email: '5588888888@okul.local' }).firestore();
    const admin = env.authenticatedContext('uid-admin',
      { email: '5550000000@okul.local', admin: true }).firestore();
    const pos = env.authenticatedContext('uid-pos').firestore();

    await assertFails(getDoc(doc(anonymous, 'ogrenciler', 'student-1')));
    await assertSucceeds(getDocs(query(collection(parent, 'veliler'),
      where('authID', '==', 'uid-parent'))));
    await assertSucceeds(getDocs(query(collection(parent, 'ogrenciler'),
      where('veliIDleri', 'array-contains', 'parent-1'))));
    await assertSucceeds(getDoc(doc(parent, 'ogrenciler', 'student-1')));
    await assertFails(getDoc(doc(parent, 'ogrenciler', 'student-2')));
    await assertFails(getDoc(doc(stranger, 'ogrenciler', 'student-1')));
    await assertFails(getDoc(doc(inactive, 'ogrenciler', 'student-1')));
    await assertFails(updateDoc(doc(parent, 'veliler', 'parent-1'), { role: 'admin' }));
    await assertFails(updateDoc(doc(parent, 'ogrenciler', 'student-1'), { bakiye: 999 }));

    await assertSucceeds(getDocs(query(collection(newParent, 'veliler'),
      where('authEmail', '==', '5599999999@okul.local'))));
    await assertSucceeds(updateDoc(doc(newParent, 'veliler', 'parent-unclaimed'),
      { authID: 'uid-new' }));
    await assertSucceeds(setDoc(doc(newParent, 'parent_auth', 'uid-new'),
      { veliId: 'parent-unclaimed' }));
    await assertSucceeds(getDoc(doc(newParent, 'ogrenciler', 'student-1')));
    await assertFails(setDoc(doc(newParent, 'parent_auth', 'uid-new'),
      { veliId: 'parent-1' }));

    await assertSucceeds(getDoc(doc(admin, 'ogrenciler', 'student-2')));
    await assertSucceeds(getDocs(collection(admin, 'veliler')));
    await assertSucceeds(getDoc(doc(pos, 'ogrenciler', 'student-1')));
    await assertSucceeds(updateDoc(doc(pos, 'urunler', 'product-1'), { stok: 4 }));
    await assertFails(updateDoc(doc(pos, 'urunler', 'product-1'), { stok: 6 }));

    const sale = {
      satisId: 'sale-1', posUid: 'uid-pos', durum: 'tamamlandi',
      ogrenciId: 'student-1', urunler: [], toplamTutar: 1,
      toplamMaliyet: 0, oncekiBakiye: 50, yeniBakiye: 49, tarih: new Date(),
    };
    await assertSucceeds(setDoc(doc(pos, 'satislar', 'sale-1'), sale));
    await assertFails(setDoc(doc(stranger, 'satislar', 'sale-2'),
      { ...sale, satisId: 'sale-2', posUid: 'uid-stranger' }));
    await assertFails(getDocs(collection(pos, 'satislar')));
    assert.equal((await getDoc(doc(admin, 'satislar', 'sale-1'))).data().posUid, 'uid-pos');
  } finally {
    await env.cleanup();
  }
});
