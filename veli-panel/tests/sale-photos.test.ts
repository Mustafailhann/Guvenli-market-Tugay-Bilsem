import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotoError, type PhotoActor, type PhotoRecord, type PhotoReader } from '../lib/server/photo-access.ts';
import { createPhotoHandlers } from '../lib/server/photo-handler.ts';
import { checkPhotoSession, createPhotoReader, decodeFields } from '../lib/server/photo-firebase.ts';
import { MAX_PHOTO_BYTES, normalizeJpeg, photoDigest, photoPath, savePhotoOnce, type PhotoStore } from '../lib/server/photo-storage.ts';

const saleId = 'pos_test-sale-001';
const jpeg = Uint8Array.from([255, 216, 1, 2, 3, 255, 217]);
const project = 'demo-photo-isolation';
const request = (method = 'PUT', body: Uint8Array = jpeg, headers: Record<string, string> = {}) =>
    new Request('https://panel.example/api/photos/' + saleId, {
        method, headers: { Authorization: 'Bearer test-token', 'Content-Type': 'image/jpeg', ...headers },
        ...(method === 'PUT' ? { body: Buffer.from(body) } : {}),
    });

function fixture() {
    const records: Record<string, PhotoRecord> = {
        'pos_cihazlari/pos-1': { id: 'pos-1', aktif: true },
        [`satislar/${saleId}`]: { id: saleId, satisId: saleId, durum: 'tamamlandi', posUid: 'pos-1',
            ogrenciId: 'student-1', islemFotografi: `islem_fotograflari/card/${saleId}.jpg` },
        'veliler/admin-1': { id: 'admin-1', role: 'admin', aktif: true, authID: 'admin-uid' },
        'veliler/parent-1': { id: 'parent-1', aktif: true, authID: 'parent-uid' },
        'parent_auth/parent-uid': { id: 'parent-uid', veliId: 'parent-1' },
        'ogrenciler/student-1': { id: 'student-1', veliIDleri: ['parent-1'], bakiye: 100,
            islemGecmisi: [{ satisId: saleId, tip: 'Harcama', islemFotografi: `images/${saleId}.jpg` }] },
        'urunler/product-1': { id: 'product-1', stok: 14 },
    };
    const reads: string[] = [];
    const reader: PhotoReader = {
        async get(collection, id) { reads.push(`${collection}/${id}`); return records[`${collection}/${id}`] ?? null; },
        async query(collection, field, op, value) {
            reads.push(`${collection}?${field}`);
            return Object.entries(records).filter(([path, record]) => path.startsWith(collection + '/') &&
                (op === 'EQUAL' ? record[field] === value : Array.isArray(record[field]) && record[field].includes(value)))
                .map(([, record]) => record);
        },
    };
    const images = new Map<string, Uint8Array>();
    let creates = 0;
    const store: PhotoStore = {
        async read(path) { return images.get(path) ?? null; },
        async create(path, bytes) {
            creates++;
            if (images.has(path)) throw new Error('immutable conflict');
            images.set(path, Uint8Array.from(bytes));
        },
    };
    let actor: PhotoActor = { uid: 'pos-1' };
    const dependencies = {
        projectId: () => project, enabled: () => true, verify: async () => actor,
        reader: () => reader, store, legacyOrigin: (): string | undefined => undefined,
    };
    return { records, reads, images, store, dependencies, handle: createPhotoHandlers(dependencies),
        actor: (value: PhotoActor) => { actor = value; }, creates: () => creates };
}

test('POS upload and retries store one photo and leave every accounting record unchanged', async () => {
    const f = fixture();
    const baseline = JSON.stringify(f.records);
    for (let i = 0; i < 4; i++) {
        const response = await f.handle(request(), saleId, 'PUT');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true, saleId, sha256: photoDigest(jpeg) });
    }
    assert.equal(f.creates(), 1);
    assert.equal(f.images.size, 1);
    assert.equal(JSON.stringify(f.records), baseline);
    assert.ok(f.reads.every(path => path.startsWith('pos_cihazlari/') || path.startsWith('satislar/')));
});

test('simultaneous retries are idempotent; different content cannot overwrite a photo', async () => {
    const f = fixture();
    const responses = await Promise.all(Array.from({ length: 6 }, () => f.handle(request(), saleId, 'PUT')));
    assert.ok(responses.every(r => r.status === 200));
    assert.equal(f.images.size, 1);
    const other = Uint8Array.from([255, 216, 5, 255, 217]);
    assert.equal((await f.handle(request('PUT', other), saleId, 'PUT')).status, 409);
    assert.deepEqual(f.images.get(photoPath(project, saleId)), jpeg);
});

for (const [name, mutate, status] of [
    ['unregistered POS', (f: ReturnType<typeof fixture>) => { delete f.records['pos_cihazlari/pos-1']; }, 403],
    ['inactive POS', (f: ReturnType<typeof fixture>) => { f.records['pos_cihazlari/pos-1'].aktif = false; }, 403],
    ['missing sale (offline upload must retry)', (f: ReturnType<typeof fixture>) => { delete f.records[`satislar/${saleId}`]; }, 404],
    ['unfinished sale', (f: ReturnType<typeof fixture>) => { f.records[`satislar/${saleId}`].durum = 'bekliyor'; }, 404],
    ['other device sale', (f: ReturnType<typeof fixture>) => { f.records[`satislar/${saleId}`].posUid = 'other-pos'; }, 403],
    ['wrong photo reference', (f: ReturnType<typeof fixture>) => { f.records[`satislar/${saleId}`].islemFotografi = 'other.jpg'; }, 403],
] as const) {
    test(`reject ${name} without uploading or changing accounting`, async () => {
        const f = fixture(); mutate(f);
        const baseline = JSON.stringify(f.records);
        assert.equal((await f.handle(request(), saleId, 'PUT')).status, status);
        assert.equal(f.creates(), 0);
        assert.equal(JSON.stringify(f.records), baseline);
    });
}

test('admin can view a verified sale JPEG with private no-store headers', async () => {
    const f = fixture();
    await f.handle(request(), saleId, 'PUT');
    f.actor({ uid: 'admin-uid', admin: true });
    const response = await f.handle(request('GET'), saleId, 'GET');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(response.headers.get('x-photo-storage'), 'vercel-blob');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), jpeg);
    f.records['veliler/admin-1'].aktif = false;
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 403);
});

test('parent sees only linked student sale; no permission to read sales collection is needed', async () => {
    const f = fixture(); await f.handle(request(), saleId, 'PUT');
    f.actor({ uid: 'parent-uid' }); f.reads.length = 0;
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 200);
    assert.ok(f.reads.every(path => !path.startsWith('satislar')));
    f.records['ogrenciler/student-1'].veliIDleri = ['another-parent'];
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 403);
});

test('inactive, mismapped and unlinked parents cannot read photos', async () => {
    for (const mutate of [
        (f: ReturnType<typeof fixture>) => { f.records['veliler/parent-1'].aktif = false; },
        (f: ReturnType<typeof fixture>) => { f.records['veliler/parent-1'].authID = 'another-user'; },
        (f: ReturnType<typeof fixture>) => { delete f.records['parent_auth/parent-uid']; },
        (f: ReturnType<typeof fixture>) => { f.records['ogrenciler/student-1'].islemGecmisi = [{ satisId: 'other', islemFotografi: `x/${saleId}.jpg` }]; },
    ]) {
        const f = fixture(); f.actor({ uid: 'parent-uid' }); mutate(f);
        assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 403);
    }
});

test('JWT admin claim alone or profile admin alone never grants photo access', async () => {
    const f = fixture(); f.actor({ uid: 'parent-uid', admin: true });
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 403);
    f.actor({ uid: 'admin-uid', admin: false });
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 403);
});

test('missing token, invalid JWT and traversal are rejected before Blob access', async () => {
    const f = fixture();
    assert.equal((await f.handle(request('PUT', jpeg, { Authorization: '' }), saleId, 'PUT')).status, 401);
    for (const badId of [null, '../secret', 'a/b', 'x'.repeat(101)]) {
        assert.equal((await f.handle(request(), badId, 'PUT')).status, 400);
    }
    f.dependencies.verify = async () => { throw new PhotoError(401, 'expired'); };
    assert.equal((await f.handle(request(), saleId, 'PUT')).status, 401);
    assert.equal(f.creates(), 0);
});

test('non-JPEG, truncated JPEG and oversized payloads never enter storage', async () => {
    const f = fixture();
    assert.equal((await f.handle(request('PUT', jpeg, { 'Content-Type': 'image/png' }), saleId, 'PUT')).status, 415);
    assert.equal((await f.handle(request('PUT', Uint8Array.from([255, 216, 1, 2])), saleId, 'PUT')).status, 400);
    assert.equal((await f.handle(request('PUT', jpeg, { 'Content-Length': String(MAX_PHOTO_BYTES + 1) }), saleId, 'PUT')).status, 413);
    assert.equal((await f.handle(request('PUT', new Uint8Array(MAX_PHOTO_BYTES + 1)), saleId, 'PUT')).status, 413);
    assert.equal(f.creates(), 0);
});

test('short Android JPEG trailer is normalized consistently', async () => {
    assert.deepEqual(normalizeJpeg(Uint8Array.from([...jpeg, 0, 0, 1])), jpeg);
    const f = fixture();
    const response = await f.handle(request('PUT', Uint8Array.from([...jpeg, 0, 0])), saleId, 'PUT');
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sha256, photoDigest(jpeg));
});

test('storage failure is retryable and never returns an upload acknowledgement', async () => {
    const f = fixture(); const baseline = JSON.stringify(f.records);
    f.store.create = async () => { throw new Error('storage unavailable'); };
    assert.equal((await f.handle(request(), saleId, 'PUT')).status, 503);
    assert.equal(JSON.stringify(f.records), baseline);
    assert.equal(f.images.size, 0);
});

test('immutable-write race handles conflicting data safely', async () => {
    let reads = 0;
    const store: PhotoStore = { read: async () => ++reads === 1 ? null : jpeg, create: async () => { throw new Error('race'); } };
    await assert.rejects(savePhotoOnce(store, 'sale.jpg', Uint8Array.from([255, 216, 4, 255, 217])), { status: 409 });
});

test('disabled cloud keeps legacy reads working, blocks new uploads, and exposes no Blob URLs', async () => {
    const f = fixture(); f.dependencies.enabled = () => false;
    f.dependencies.legacyOrigin = () => 'https://legacy.example';
    const handler = createPhotoHandlers({ ...f.dependencies, fetcher: async (url, init) => {
        assert.equal(url, `https://legacy.example/photos/${saleId}`);
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-token');
        return new Response(Buffer.from(jpeg), { headers: { 'Content-Type': 'image/jpeg' } });
    } });
    assert.equal((await handler(request('GET'), saleId, 'GET')).status, 200);
    assert.equal((await handler(request(), saleId, 'PUT')).status, 503);
    assert.equal(f.creates(), 0);
});

test('missing image is 404; permission failure cannot fall back to legacy', async () => {
    const f = fixture(); f.actor({ uid: 'admin-uid', admin: true });
    assert.equal((await f.handle(request('GET'), saleId, 'GET')).status, 404);
    const handler = createPhotoHandlers({ ...f.dependencies, fetcher: async () => { throw new Error('must not call'); } });
    f.actor({ uid: 'stranger' });
    assert.equal((await handler(request('GET'), saleId, 'GET')).status, 403);
});

test('Firestore adapter only performs GET and read-only runQuery under caller identity', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const reader = createPhotoReader('caller-token', project, async (url, init) => {
        calls.push({ url: String(url), init });
        return Response.json(String(url).endsWith(':runQuery') ? [] : { name: 'projects/demo/documents/pos_cihazlari/pos-1', fields: { aktif: { booleanValue: true } } });
    });
    assert.deepEqual(await reader.get('pos_cihazlari', 'pos-1'), { id: 'pos-1', aktif: true });
    await reader.query('ogrenciler', 'veliIDleri', 'ARRAY_CONTAINS', 'parent-1');
    assert.deepEqual(calls.map(c => c.init?.method), ['GET', 'POST']);
    assert.ok(calls[1].url.endsWith('/documents:runQuery'));
    assert.ok(!calls.some(c => /commit|batchWrite/.test(c.url)));
    assert.ok(calls.every(c => new Headers(c.init?.headers).get('authorization') === 'Bearer caller-token'));
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)).structuredQuery.where.fieldFilter,
        { field: { fieldPath: 'veliIDleri' }, op: 'ARRAY_CONTAINS', value: { stringValue: 'parent-1' } });
});

test('Firestore denial, network failure and missing docs are preserved', async () => {
    for (const status of [401, 403, 503]) {
        const reader = createPhotoReader('token', project, async () => new Response('', { status }));
        await assert.rejects(reader.get('satislar', saleId), { status });
    }
    assert.equal(await createPhotoReader('token', project, async () => new Response('', { status: 404 })).get('satislar', saleId), null);
});

test('missing cloud photo never contacts retired PC tunnel or returns its 530 error', async () => {
    const f = fixture();
    f.actor({ uid: 'admin-uid', admin: true });
    let legacyCalls = 0;
    const handler = createPhotoHandlers({ ...f.dependencies,
        legacyOrigin: () => 'https://retired-photo.example',
        fetcher: async () => { legacyCalls++; return new Response('Tunnel offline', { status: 530 }); },
    });
    const result = await handler(request('GET'), saleId, 'GET');
    assert.equal(result.status, 404);
    assert.equal(legacyCalls, 0);
});

test('decode nested Firestore history without coercing student identifiers', () => {
    assert.deepEqual(decodeFields({ card: { stringValue: '00123' },
        history: { arrayValue: { values: [{ mapValue: { fields: { satisId: { stringValue: saleId }, tutar: { doubleValue: 1.5 } } } }] } },
        count: { integerValue: '14' } }), { card: '00123', history: [{ satisId: saleId, tutar: 1.5 }], count: 14 });
});

test('revoked, disabled and deleted Firebase accounts cannot open photos', async () => {
    const oldKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'public-test-key';
    try {
        for (const users of [[], [{ localId: 'uid', disabled: true }], [{ localId: 'other' }], [{ localId: 'uid', validSince: '101' }]]) {
            await assert.rejects(checkPhotoSession('token', 'uid', 100, async () => Response.json({ users })), { status: 401 });
        }
        await checkPhotoSession('token', 'uid', 100, async () => Response.json({ users: [{ localId: 'uid', validSince: '100', disabled: false }] }));
    } finally {
        if (oldKey === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
        else process.env.NEXT_PUBLIC_FIREBASE_API_KEY = oldKey;
    }
});
