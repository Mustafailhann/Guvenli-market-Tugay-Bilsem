import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createPhotoReader } from '../lib/server/photo-firebase.ts';
import { allowPhotoRead, allowPhotoUpload } from '../lib/server/photo-access.ts';

const rulesRequire = createRequire(new URL('../../rules-tests/package.json', import.meta.url));
const { initializeTestEnvironment } = rulesRequire('@firebase/rules-unit-testing');
const { createMockUserToken } = rulesRequire('@firebase/util');
rulesRequire('firebase/compat/firestore');
interface FixtureContext {
    firestore(): { doc(path: string): {
        get(): Promise<{ data(): unknown }>;
        set(data: unknown): Promise<void>;
    } };
}

test('cloud photo authorization uses the existing live rules without accounting writes', async () => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    assert.match(host || '', /^127\.0\.0\.1:\d+$/, 'Only a local emulator is allowed');
    const projectId = 'demo-photo-cloud-rules';
    const env = await initializeTestEnvironment({ projectId, firestore: {
        host: '127.0.0.1', port: Number(host!.split(':')[1]),
        rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8'),
    } });
    const saleId = 'pos_cloud-photo-test';
    const photo = `islem_fotograflari/card/${saleId}.jpg`;
    async function snapshot() {
        return env.withSecurityRulesDisabled(async (context: FixtureContext) => {
            const db = context.firestore();
            return Object.fromEntries(await Promise.all(['ogrenciler/student', 'urunler/product', `satislar/${saleId}`, 'stok_hareketleri/movement']
                .map(async item => [item, (await db.doc(item).get()).data()])));
        });
    }
    function reader(uid: string, admin = false) {
        const token = createMockUserToken({ sub: uid, email: `${uid}@okul.local`, admin }, projectId);
        return createPhotoReader(token, projectId, async (url, init) => {
            assert.ok(String(url).startsWith('https://firestore.googleapis.com/v1/projects/' + projectId + '/'));
            return fetch(String(url).replace('https://firestore.googleapis.com', `http://${host}`), init);
        });
    }
    try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context: FixtureContext) => {
            const db = context.firestore();
            const records = {
                'pos_cihazlari/pos': { aktif: true },
                'veliler/admin': { authID: 'admin', role: 'admin', aktif: true },
                'veliler/parent': { authID: 'parent', aktif: true },
                'veliler/stranger': { authID: 'stranger', aktif: true },
                'parent_auth/parent': { veliId: 'parent' },
                'parent_auth/stranger': { veliId: 'stranger' },
                'ogrenciler/student': { bakiye: 85, veliIDleri: ['parent'], islemGecmisi: [{ satisId: saleId, islemFotografi: photo }] },
                'urunler/product': { stok: 14 },
                [`satislar/${saleId}`]: { satisId: saleId, durum: 'tamamlandi', posUid: 'pos', ogrenciId: 'student', islemFotografi: photo },
                'stok_hareketleri/movement': { miktarDegisimi: -1, yeniStok: 14 },
            };
            for (const [name, data] of Object.entries(records)) await db.doc(name).set(data);
        });
        const baseline = await snapshot();
        await allowPhotoUpload(reader('pos'), { uid: 'pos' }, saleId);
        await allowPhotoRead(reader('admin', true), { uid: 'admin', admin: true }, saleId);
        await allowPhotoRead(reader('parent'), { uid: 'parent' }, saleId);
        await assert.rejects(allowPhotoRead(reader('stranger'), { uid: 'stranger' }, saleId), { status: 403 });
        await assert.rejects(allowPhotoUpload(reader('parent'), { uid: 'parent' }, saleId), { status: 403 });
        await assert.rejects(reader('parent').get('satislar', saleId), { status: 403 });
        assert.deepEqual(await snapshot(), baseline);
    } finally { await env.cleanup(); }
});
