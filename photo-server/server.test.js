'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm } = require('node:fs/promises');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHandler } = require('./server');
const { viewerCanAccessStudent } = require('./authorization');

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 0xff, 0xd9]);
const jpegWithCameraTrailer = Buffer.concat([jpeg, Buffer.from('ctrace\0\0')]);

async function request(handler, { method = 'GET', uid, body, contentType } = {}) {
  const req = Readable.from(body ? [body] : []);
  req.method = method;
  req.url = '/photos/sale-1';
  req.headers = {
    ...(uid ? { authorization: `Bearer ${uid}` } : {}),
    ...(contentType ? { 'content-type': contentType } : {}),
  };
  const chunks = [];
  const res = {
    status: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers) {
      this.status = status;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(data) { if (data) chunks.push(Buffer.from(data)); },
  };
  await handler(req, res);
  return { status: res.status, body: Buffer.concat(chunks), headers: res.headers };
}

test('veli yalnızca kendi çocuğunu, yönetici tümünü görebilir', () => {
  const sale = { ogrenciId: 'ogrenci-1' };
  const student = { kartID: '123', veliIDleri: ['veli-1'] };
  assert.equal(viewerCanAccessStudent({ id: 'veli-1', aktif: true }, student, sale), true);
  assert.equal(viewerCanAccessStudent({ id: 'veli-2', aktif: true }, student, sale), false);
  assert.equal(viewerCanAccessStudent({ id: 'veli-2', aktif: false }, student, sale), false);
  assert.equal(viewerCanAccessStudent({ id: 'admin', role: 'admin' }, student, sale), false);
  assert.equal(viewerCanAccessStudent({ id: 'admin', role: 'admin' }, student, sale,
    [], { admin: true }), true);
  assert.equal(viewerCanAccessStudent({ id: 'veli-2' }, student, sale,
    [{ kartID: '123', durum: 'beklemede' }]), false);
  assert.equal(viewerCanAccessStudent({ id: 'veli-2' }, student, sale,
    [{ kartID: '123', durum: 'onaylandi' }]), true);
});

test('yükleme POS kimliği ve satışla eşleşir; tekrar aynı dosya güvenlidir', async () => {
  const dataDir = await mkdtemp(path.join(__dirname, '.photo-test-'));
  const handler = createHandler({
    verifyToken: async (token) => ({ uid: token }),
    getSale: async () => ({ durum: 'tamamlandi', ogrenciId: 'ogrenci-1',
      posUid: 'pos-1', islemFotografi: 'islem_fotograflari/123/sale-1.jpg' }),
    canView: async (actor) => actor.uid === 'veli-1',
    allowedPosUids: new Set(['pos-1']),
    dataDir,
  });
  try {
    const unauthorized = await request(handler);
    assert.equal(unauthorized.status, 401);
    const wrongPos = await request(handler, { method: 'PUT', uid: 'stranger',
      contentType: 'image/jpeg', body: jpeg });
    assert.equal(wrongPos.status, 403);
    const simultaneous = await Promise.all([jpegWithCameraTrailer, jpeg].map((body) => request(handler, {
      method: 'PUT', uid: 'pos-1', contentType: 'image/jpeg', body,
    })));
    assert.deepEqual(simultaneous.map((result) => result.status), [200, 200]);
    const otherParent = await request(handler, { uid: 'veli-2' });
    assert.equal(otherParent.status, 403);
    const ownParent = await request(handler, { uid: 'veli-1' });
    assert.equal(ownParent.status, 200);
    assert.deepEqual(ownParent.body, jpeg);
    const different = await request(handler, { method: 'PUT', uid: 'pos-1',
      contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]) });
    assert.equal(different.status, 409);
    const invalid = await request(handler, { method: 'PUT', uid: 'pos-1',
      contentType: 'image/jpeg', body: Buffer.from('not-a-jpeg') });
    assert.equal(invalid.status, 415);
  } finally {
    if (!path.resolve(dataDir).startsWith(path.resolve(__dirname) + path.sep)) {
      throw new Error('Test klasörü çalışma alanı dışında.');
    }
    await rm(dataDir, { recursive: true, force: true });
  }
});
