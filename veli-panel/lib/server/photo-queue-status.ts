import { PhotoError, type PhotoActor, type PhotoReader } from './photo-access.ts';

interface StatusDependencies {
    verify(token: string): Promise<PhotoActor>;
    reader(token: string): PhotoReader;
    report(status: PhotoQueueStatus): void;
}

export interface PhotoQueueStatus {
    pending: number;
    retrying: number;
    lastUploadStatus: number;
    lastError: string;
}

const errorTypes = new Set(['none', 'network', 'invalid_jpeg', 'file_read', 'server', 'auth', 'queue_read']);
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

// Counts only: no JWT, photo bytes, sale IDs, student names or financial writes.
export function createPhotoQueueStatusHandler(deps: StatusDependencies) {
    return async (request: Request) => {
        const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
        if (!token) return new Response('Oturum gerekli.', { status: 401, headers });
        try {
            const actor = await deps.verify(token);
            const pos = await deps.reader(token).get('pos_cihazlari', actor.uid);
            if (!pos || pos.aktif !== true) throw new PhotoError(403, 'Etkin POS gerekli.');
            if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') {
                throw new PhotoError(415, 'JSON gerekli.');
            }
            const reader = request.body?.getReader();
            if (!reader) throw new PhotoError(400, 'Durum gerekli.');
            const chunks: Uint8Array[] = [];
            let size = 0;
            try {
                while (true) {
                    const part = await reader.read();
                    if (part.done) break;
                    size += part.value.length;
                    if (size > 1024) { await reader.cancel(); throw new PhotoError(413, 'Durum çok büyük.'); }
                    chunks.push(part.value);
                }
            } finally { reader.releaseLock(); }
            let body: unknown;
            try { body = JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
            catch { throw new PhotoError(400, 'Geçersiz durum.'); }
            if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PhotoError(400, 'Geçersiz durum.');
            const data = body as Record<string, unknown>;
            const { pending, retrying, lastUploadStatus, lastError } = data;
            if (Object.keys(data).length !== 4 ||
                typeof pending !== 'number' || !Number.isInteger(pending) || pending < 0 || pending > 100000 ||
                typeof retrying !== 'number' || !Number.isInteger(retrying) || retrying < 0 || retrying > pending ||
                typeof lastUploadStatus !== 'number' || !Number.isInteger(lastUploadStatus) || lastUploadStatus < 0 || lastUploadStatus > 599 ||
                typeof lastError !== 'string' || !errorTypes.has(lastError)) {
                throw new PhotoError(400, 'Geçersiz durum.');
            }
            deps.report({ pending, retrying, lastUploadStatus, lastError });
            return Response.json({ ok: true }, { headers });
        } catch (error) {
            const status = error instanceof PhotoError ? error.status : 503;
            return new Response('Fotoğraf kuyruk durumu alınamadı.', { status, headers });
        }
    };
}
