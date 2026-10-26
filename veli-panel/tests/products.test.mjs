import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesRequire = createRequire(path.join(here, '../../rules-tests/package.json'));
const { initializeTestEnvironment, assertFails } = rulesRequire('@firebase/rules-unit-testing');
const firestore = rulesRequire('firebase/firestore');
const { doc, getDoc, getDocs, collection, setDoc, updateDoc, runTransaction } = firestore;

test('stok girişleri gerçek Firestore transaction ve kurallarıyla tutarlıdır', async t => {
    const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
    assert.ok(endpoint?.startsWith('127.0.0.1:'), 'Bu test yalnız yerel Firestore emülatöründe çalışır.');
    const env = await initializeTestEnvironment({
        projectId: 'demo-stock-ledger',
        firestore: { host: '127.0.0.1', port: Number(endpoint.split(':')[1]), rules: fs.readFileSync(path.join(here, '../../firestore.rules'), 'utf8') },
    });
    const db = env.authenticatedContext('stock-admin', { admin: true }).firestore()._delegate;
    const filename = path.join(here, '../lib/products.ts');
    const subject = new Module(filename);
    subject.filename = filename;
    subject.paths = Module._nodeModulePaths(path.dirname(filename));
    subject.require = specifier => {
        if (specifier === './firebase') return { db };
        if (specifier === 'firebase/firestore') return firestore;
        return Module.prototype.require.call(subject, specifier);
    };
    subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, filename);
    const { addProduct, addStockWithLedger, updateStockWithLedger, updateProductWithStockLedger, subscribeProducts } = subject.exports;
    const productRef = doc(db, 'urunler', 'kraker');
    const ledger = () => getDocs(collection(db, 'stok_hareketleri'));
    async function reset(stock = 14) {
        await env.clearFirestore();
        await setDoc(productRef, { ad: 'Kraker', stok: stock, fiyat: 15 });
    }
    try {
        await t.test('yeni ürünün ilk stoku ve tarihli defter kaydı birlikte oluşur', async () => {
            await env.clearFirestore();
            const result = await addProduct({ ad: 'Yeni Kraker', stok: 14, fiyat: 15 }, 'Yönetici');
            assert.equal(result.success, true);
            assert.equal((await getDoc(doc(db, 'urunler', result.id))).data().stok, 14);
            const entries = await ledger();
            assert.equal(entries.size, 1);
            const saved = entries.docs[0].data();
            assert.equal(saved.eskiStok, 0);
            assert.equal(saved.yeniStok, 14);
            assert.equal(saved.miktarDegisimi, 14);
            assert.equal(saved.urunId, result.id);
            assert.ok(saved.tarih.toDate() instanceof Date);
        });
        await t.test('aynı stok girişi iki kez gönderilse de bir kez eklenir', async () => {
            await reset();
            const results = await Promise.all([
                addStockWithLedger('kraker', 6, 'Yönetici', 'same-operation'),
                addStockWithLedger('kraker', 6, 'Yönetici', 'same-operation'),
            ]);
            assert.ok(results.every(result => result.success));
            assert.equal((await getDoc(productRef)).data().stok, 20);
            assert.equal((await ledger()).size, 1);
        });
        await t.test('eşzamanlı satış ve iki ayrı stok girişi birbirini ezmez', async () => {
            await reset(14);
            const results = await Promise.all([
                addStockWithLedger('kraker', 5, 'Yönetici', 'receipt-one'),
                addStockWithLedger('kraker', 7, 'Yönetici', 'receipt-two'),
                runTransaction(db, async tx => {
                    const snap = await tx.get(productRef);
                    tx.update(productRef, { stok: snap.data().stok - 3 });
                }),
            ]);
            assert.equal(results[0].success, true);
            assert.equal(results[1].success, true);
            assert.equal((await getDoc(productRef)).data().stok, 23);
            const entries = await ledger();
            assert.equal(entries.size, 2);
            for (const entry of entries.docs) {
                const data = entry.data();
                assert.equal(data.yeniStok - data.eskiStok, data.miktarDegisimi);
            }
        });
        await t.test('fiyat düzenlemesi form açıldıktan sonra satılan stoğu geri eklemez', async () => {
            await reset(13); // Form açılırken 14 idi; bu sırada bir ürün satıldı.
            const result = await updateProductWithStockLedger('kraker', { stok: 14, fiyat: 20 }, 'Yönetici', 14);
            assert.equal(result.success, true);
            const product = (await getDoc(productRef)).data();
            assert.equal(product.stok, 13);
            assert.equal(product.fiyat, 20);
            assert.equal((await ledger()).size, 0);
        });
        await t.test('eski ekrandan stok düzeltmesi yeni satışları ezemez', async () => {
            await reset(13);
            assert.equal((await updateStockWithLedger('kraker', 20, 'Yönetici', 14)).success, false);
            assert.equal((await updateProductWithStockLedger('kraker', { stok: 20 }, 'Yönetici', 14)).success, false);
            assert.equal((await getDoc(productRef)).data().stok, 13);
            assert.equal((await ledger()).size, 0);
        });
        await t.test('geçerli düzeltme tek tarihli hareket oluşturur', async () => {
            await reset();
            assert.equal((await updateStockWithLedger('kraker', 10, 'Yönetici', 14)).success, true);
            const entries = await ledger();
            assert.equal(entries.size, 1);
            const entry = entries.docs[0];
            assert.equal(entry.data().miktarDegisimi, -4);
            assert.equal(entry.data().yeniStok, 10);
            await assertFails(updateDoc(doc(db, 'stok_hareketleri', entry.id), { yeniStok: 999 }));
        });
        await t.test('geçersiz miktar, eksik ürün ve kimlik çakışması stok değiştirmez', async () => {
            await reset();
            for (const quantity of [0, -1, 1.5, NaN, Infinity]) {
                assert.equal((await addStockWithLedger('kraker', quantity)).success, false);
            }
            assert.equal((await addStockWithLedger('missing', 2)).success, false);
            assert.equal((await ledger()).size, 0);
            await addStockWithLedger('kraker', 2, 'Yönetici', 'operation-used');
            assert.equal((await addStockWithLedger('kraker', 3, 'Yönetici', 'operation-used')).success, false);
            assert.equal((await getDoc(productRef)).data().stok, 16);
            assert.equal((await ledger()).size, 1);
        });
        await t.test('ürün aboneliği satış sonrası güncel stoğu bildirir', async () => {
            await reset();
            await new Promise((resolve, reject) => {
                const timer = setTimeout(() => { unsubscribe(); reject(new Error('Stok güncellenmedi.')); }, 5000);
                const unsubscribe = subscribeProducts(products => {
                    const product = products.find(product => product.id === 'kraker');
                    if (product?.stok === 14) updateDoc(productRef, { stok: 13 }).catch(reject);
                    if (product?.stok === 13) { clearTimeout(timer); unsubscribe(); resolve(); }
                }, reject);
            });
        });
    } finally {
        await env.cleanup();
    }
});
