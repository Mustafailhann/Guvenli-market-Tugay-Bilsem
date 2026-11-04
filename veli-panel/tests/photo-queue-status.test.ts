import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotoError, type PhotoReader } from '../lib/server/photo-access.ts';
import { createPhotoQueueStatusHandler, type PhotoQueueStatus } from '../lib/server/photo-queue-status.ts';

const valid = { pending: 3, retrying: 1, lastUploadStatus: 403, lastError: 'server' };
function fixture(active = true) {
    const reports: PhotoQueueStatus[] = [];
    const reads: string[] = [];
    const records = { pos: { id: 'pos-1', aktif: active }, sale: { total: 25 }, student: { balance: 100 }, product: { stock: 14 } };
    const reader: PhotoReader = {
        async get(collection, id) { reads.push(`${collection}/${id}`); return collection === 'pos_cihazlari' && id === 'pos-1' ? records.pos : null; },
        async query() { throw new Error('Status must not query financial or student data'); },
    };
    const handle = createPhotoQueueStatusHandler({
        verify: async token => { if (token !== 'pos-token') throw new PhotoError(401, 'Invalid'); return { uid: 'pos-1' }; },
        reader: () => reader, report: status => reports.push(status),
    });
    return { handle, reports, reads, records };
}
const request = (body: unknown, token = 'pos-token') => new Request('https://panel.example/api/photos/status', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
});

test('queue counts from active POS are recorded without reading or writing financial data', async () => {
    const f = fixture();
    const baseline = JSON.stringify(f.records);
    const result = await f.handle(request(valid));
    assert.equal(result.status, 200);
    assert.deepEqual(f.reports, [valid]);
    assert.deepEqual(f.reads, ['pos_cihazlari/pos-1']);
    assert.equal(JSON.stringify(f.records), baseline);
    assert.match(result.headers.get('cache-control')!, /private.*no-store/);
});

test('empty queues are reported too, without exposing any sale identifiers', async () => {
    const f = fixture();
    const status = { pending: 0, retrying: 0, lastUploadStatus: 200, lastError: 'none' };
    assert.equal((await f.handle(request(status))).status, 200);
    assert.deepEqual(f.reports, [status]);
});

test('missing or invalid session and inactive POS cannot submit diagnostics', async () => {
    for (const token of ['', 'invalid']) {
        const f = fixture();
        assert.equal((await f.handle(request(valid, token))).status, 401);
        assert.equal(f.reports.length, 0);
        assert.equal(f.reads.length, 0);
    }
    const f = fixture(false);
    assert.equal((await f.handle(request(valid))).status, 403);
    assert.equal(f.reports.length, 0);
});

test('only bounded counts and predefined error types may enter logs', async () => {
    for (const body of [null, [], { ...valid, saleId: 'private-id' }, { ...valid, lastError: 'private student data' },
        { ...valid, pending: -1 }, { ...valid, retrying: 4 }, { ...valid, lastUploadStatus: 900 }]) {
        const f = fixture();
        assert.equal((await f.handle(request(body))).status, 400);
        assert.equal(f.reports.length, 0);
    }
    const f = fixture();
    assert.equal((await f.handle(request({ note: 'x'.repeat(2000) }))).status, 413);
    assert.equal(f.reports.length, 0);
});
