'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const SALE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const JPEG_END = Buffer.from([0xff, 0xd9]);
const saveLocks = new Map();

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJpeg(req) {
  const parts = [];
  let length = 0;
  for await (const part of req) {
    length += part.length;
    if (length > MAX_PHOTO_BYTES) {
      const error = new Error('Fotoğraf 5 MB sınırını aşıyor.');
      error.status = 413;
      throw error;
    }
    parts.push(part);
  }
  const buffer = Buffer.concat(parts);
  const end = buffer.lastIndexOf(JPEG_END);
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8 ||
      end < 2 || buffer.length - end - 2 > 64 * 1024) {
    const error = new Error('Geçerli bir JPEG gerekli.');
    error.status = 415;
    throw error;
  }
  // Bazı Android kameraları JPEG bitişinden sonra özel izleme verisi ekler.
  // Fotoğrafı yalnız JPEG bitiş işaretine kadar sakla.
  return buffer.subarray(0, end + 2);
}

async function saveJpeg(dataDir, saleId, jpeg) {
  await fs.mkdir(dataDir, { recursive: true });
  const filename = path.join(dataDir, `${saleId}.jpg`);
  const previous = saveLocks.get(filename) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      const existing = await fs.readFile(filename);
      if (!crypto.timingSafeEqual(
        crypto.createHash('sha256').update(existing).digest(),
        crypto.createHash('sha256').update(jpeg).digest(),
      )) {
        const conflict = new Error('Bu satışın farklı bir fotoğrafı zaten kayıtlı.');
        conflict.status = 409;
        throw conflict;
      }
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const temporary = path.join(dataDir, `.${saleId}.${crypto.randomUUID()}.tmp`);
    await fs.writeFile(temporary, jpeg, { flag: 'wx', mode: 0o600 });
    try {
      // One server process owns this directory; the per-sale lock serializes
      // writes while rename keeps incomplete JPEGs invisible to readers.
      await fs.rename(temporary, filename);
    } finally {
      await fs.unlink(temporary).catch(() => {});
    }
  });
  saveLocks.set(filename, current);
  try { await current; } finally {
    if (saveLocks.get(filename) === current) saveLocks.delete(filename);
  }
}

function createHandler({ verifyToken, getSale, canView, allowedPosUids, dataDir, logger = console }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method === 'GET' && req.url === '/health') {
      return json(res, 200, { ok: true });
    }

    const match = /^\/photos\/([A-Za-z0-9_-]{1,100})$/.exec(req.url || '');
    if (!match || !SALE_ID_PATTERN.test(match[1]) || !['GET', 'PUT'].includes(req.method)) {
      return json(res, 404, { error: 'Bulunamadı.' });
    }
    const saleId = match[1];
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    if (!token) return json(res, 401, { error: 'Oturum gerekli.' });

    try {
      const actor = await verifyToken(token);
      if (!actor?.uid) return json(res, 401, { error: 'Geçersiz oturum.' });
      const sale = await getSale(saleId);
      if (!sale || sale.durum !== 'tamamlandi') {
        return json(res, 404, { error: 'Satış kaydı henüz sunucuda yok.' });
      }
      const filename = path.join(dataDir, `${saleId}.jpg`);

      if (req.method === 'PUT') {
        if (!allowedPosUids.has(actor.uid) || sale.posUid !== actor.uid ||
            !sale.islemFotografi || !sale.ogrenciId) {
          return json(res, 403, { error: 'Bu POS fotoğraf yükleyemez.' });
        }
        if (req.headers['content-type'] !== 'image/jpeg') {
          return json(res, 415, { error: 'JPEG gerekli.' });
        }
        const jpeg = await readJpeg(req);
        await saveJpeg(dataDir, saleId, jpeg);
        return json(res, 200, { ok: true });
      }

      if (!await canView(actor, sale)) {
        return json(res, 403, { error: 'Bu fotoğrafı görme yetkiniz yok.' });
      }
      let jpeg;
      try {
        jpeg = await fs.readFile(filename);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return json(res, 404, { error: 'Fotoğraf henüz yüklenmedi.' });
        }
        throw error;
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': jpeg.length,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(jpeg);
    } catch (error) {
      if (error.code?.startsWith('auth/')) {
        return json(res, 401, { error: 'Geçersiz oturum.' });
      }
      if (error.status) return json(res, error.status, { error: error.message });
      logger.error('photo server:', error);
      return json(res, 500, { error: 'Fotoğraf sunucusu hatası.' });
    }
  };
}

module.exports = { createHandler, saveJpeg, MAX_PHOTO_BYTES };
