import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import * as model from '../lib/category-model.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const rulesRequire = createRequire(path.join(here, '../../rules-tests/package.json'));
const { initializeTestEnvironment, assertFails } = rulesRequire('@firebase/rules-unit-testing');
const firestore = rulesRequire('firebase/firestore');
const { doc, collection, setDoc, getDoc, getDocs } = firestore;

test('category management uses existing rules and never changes accounting or stock', async t => {
    const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
    assert.match(endpoint || '', /^127\.0\.0\.1:\d+$/, 'Only a local emulator is allowed');
    const env = await initializeTestEnvironment({ projectId: 'demo-category-manager', firestore: {
        host: '127.0.0.1', port: Number(endpoint.split(':')[1]),
        rules: fs.readFileSync(path.join(here, '../../firestore.rules'), 'utf8'),
    } });
    const db = env.authenticatedContext('category-admin', { admin: true }).firestore()._delegate;
    const filename = path.join(here, '../lib/categories.ts');
    const subject = new Module(filename);
    subject.filename = filename;
    subject.paths = Module._nodeModulePaths(path.dirname(filename));
    subject.require = specifier => {
        if (specifier === './firebase') return { db, auth: { currentUser: { uid: 'category-admin' } } };
        if (specifier === './category-model.ts') return model;
        if (specifier === 'firebase/firestore') return firestore;
        return Module.prototype.require.call(subject, specifier);
    };
    subject._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, filename);
    const { saveCategories } = subject.exports;
    const ref = doc(db, 'app_settings', model.categorySettingsPath);
    async function reset() {
        await env.clearFirestore();
        await Promise.all([
            setDoc(doc(db, 'urunler', 'water-primary-id'), { ad: 'Su', kategori: 'İçecekler', stok: 14, fiyat: 10 }),
            setDoc(doc(db, 'ogrenciler', 'student'), { bakiye: 100, kartID: '1234567890' }),
            setDoc(doc(db, 'satislar', 'old-sale'), { tutar: 10, durum: 'tamamlandi' }),
            setDoc(doc(db, 'stok_hareketleri', 'old-movement'), { miktarDegisimi: 14, urunId: 'water-primary-id' }),
        ]);
    }
    async function accounting() {
        const tables = await Promise.all(['urunler', 'ogrenciler', 'satislar', 'stok_hareketleri'].map(async table => {
            const result = await getDocs(collection(db, table));
            return [table, result.docs.map(item => [item.id, item.data()]).sort((a, b) => a[0].localeCompare(b[0]))];
        }));
        return JSON.stringify(tables);
    }
    try {
        await t.test('rename, recolor and reorder write only category settings', async () => {
            await reset();
            const before = await accounting();
            const categories = model.defaultCategorySettings().categories.reverse();
            Object.assign(categories.find(item => item.key === 'İçecekler'), { name: 'Soğuk İçecekler', color: '#112233', icon: 'basket' });
            const saved = await saveCategories(categories, 0);
            assert.equal(saved.revision, 1);
            assert.equal((await getDoc(ref)).data().categories.at(-1).key, 'İçecekler');
            assert.equal(await accounting(), before);
        });
        await t.test('a category containing a product cannot be removed', async () => {
            await reset();
            const before = await accounting();
            const categories = model.defaultCategorySettings().categories;
            categories[0].active = false;
            await assert.rejects(saveCategories(categories, 0), /kategorisinde ürün var/);
            assert.equal((await getDoc(ref)).exists(), false);
            assert.equal(await accounting(), before);
        });
        await t.test('empty category removal retains its stable key and changes no stock', async () => {
            await reset();
            const before = await accounting();
            const categories = model.defaultCategorySettings().categories;
            categories.find(item => item.key === 'Gofretler').active = false;
            await saveCategories(categories, 0);
            assert.equal((await getDoc(ref)).data().categories.find(item => item.key === 'Gofretler').active, false);
            assert.equal(await accounting(), before);
        });
        await t.test('stale or simultaneous admin edits cannot silently overwrite each other', async () => {
            await reset();
            const before = await accounting();
            const first = model.defaultCategorySettings().categories;
            const second = model.defaultCategorySettings().categories;
            first[0].name = 'Yönetici A'; second[0].name = 'Yönetici B';
            const results = await Promise.allSettled([saveCategories(first, 0), saveCategories(second, 0)]);
            assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
            assert.equal(results.filter(item => item.status === 'rejected').length, 1);
            assert.equal((await getDoc(ref)).data().revision, 1);
            await assert.rejects(saveCategories(first, 0), /başka bir yönetici/);
            assert.equal(await accounting(), before);
        });
        await t.test('existing keys cannot be replaced while changing a label', async () => {
            await reset();
            const categories = model.defaultCategorySettings().categories;
            categories[0].key = 'changed-key';
            await assert.rejects(saveCategories(categories, 0), /ürün bağlantısı/);
            assert.equal((await getDoc(ref)).exists(), false);
        });
        await t.test('registered POS can read settings; POS and parents cannot change them', async () => {
            await reset();
            await saveCategories(model.defaultCategorySettings().categories, 0);
            await setDoc(doc(db, 'pos_cihazlari', 'tablet'), { aktif: true });
            const posDb = env.authenticatedContext('tablet').firestore()._delegate;
            const parentDb = env.authenticatedContext('parent').firestore()._delegate;
            assert.equal((await getDoc(doc(posDb, 'app_settings', model.categorySettingsPath))).exists(), true);
            await assertFails(setDoc(doc(posDb, 'app_settings', model.categorySettingsPath), { revision: 99 }));
            await assertFails(getDoc(doc(parentDb, 'app_settings', model.categorySettingsPath)));
            await assertFails(setDoc(doc(parentDb, 'app_settings', model.categorySettingsPath), { revision: 99 }));
        });
    } finally { await env.cleanup(); }
});
