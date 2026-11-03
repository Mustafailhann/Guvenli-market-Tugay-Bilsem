import { PhotoError, saleIdPattern, allowPhotoRead, allowPhotoUpload, type PhotoActor, type PhotoReader } from './photo-access.ts';
import { MAX_PHOTO_BYTES, normalizeJpeg, photoPath, savePhotoOnce, type PhotoStore } from './photo-storage.ts';

interface PhotoDependencies {
    projectId(): string;
    enabled(): boolean;
    verify(token: string): Promise<PhotoActor>;
    reader(token: string): PhotoReader;
    store: PhotoStore;
    legacyOrigin(): string | undefined;
    fetcher?: typeof fetch;
}

const privateHeaders = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
const message = (text: string, status: number) => new Response(text, { status, headers: privateHeaders });

async function readBody(request: Request) {
    if (Number(request.headers.get('content-length')) > MAX_PHOTO_BYTES) throw new PhotoError(413, 'Fotoğraf çok büyük.');
    const reader = request.body?.getReader();
    if (!reader) throw new PhotoError(400, 'Fotoğraf gerekli.');
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            length += item.value.byteLength;
            if (length > MAX_PHOTO_BYTES) { await reader.cancel(); throw new PhotoError(413, 'Fotoğraf çok büyük.'); }
            chunks.push(item.value);
        }
    } finally { reader.releaseLock(); }
    return normalizeJpeg(Buffer.concat(chunks, length));
}

export function createPhotoHandlers(deps: PhotoDependencies) {
    async function legacy(token: string, saleId: string) {
        const origin = deps.legacyOrigin();
        if (!origin || !origin.startsWith('https://')) return message('Fotoğraf henüz yüklenmedi.', 404);
        const response = await (deps.fetcher || fetch)(`${origin.replace(/\/$/, '')}/photos/${saleId}`, {
            headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) return message('Fotoğraf görüntülenemedi.', response.status);
        if (response.headers.get('content-type')?.split(';')[0] !== 'image/jpeg') return message('Geçersiz görsel yanıtı.', 502);
        return new Response(response.body, { headers: { ...privateHeaders, 'Content-Type': 'image/jpeg' } });
    }
    return async (request: Request, saleId: string | null, method: 'GET' | 'PUT') => {
        if (!saleId || !saleIdPattern.test(saleId)) return message('Geçersiz satış kimliği.', 400);
        const token = /^Bearer (\S+)$/i.exec(request.headers.get('authorization') || '')?.[1];
        if (!token) return message('Oturum gerekli.', 401);
        try {
            if (!deps.enabled()) {
                return method === 'GET' ? await legacy(token, saleId) : message('Bulut fotoğraf deposu henüz etkin değil.', 503);
            }
            const actor = await deps.verify(token);
            const reader = deps.reader(token);
            const path = photoPath(deps.projectId(), saleId);
            if (method === 'GET') {
                await allowPhotoRead(reader, actor, saleId);
                const bytes = await deps.store.read(path);
                if (!bytes) return await legacy(token, saleId);
                return new Response(Buffer.from(bytes), { headers: {
                    ...privateHeaders, 'Content-Type': 'image/jpeg', 'X-Photo-Storage': 'vercel-blob',
                } });
            }
            await allowPhotoUpload(reader, actor, saleId);
            if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
                return message('Yalnız JPEG yüklenebilir.', 415);
            }
            const bytes = await readBody(request);
            const result = await savePhotoOnce(deps.store, path, bytes);
            return Response.json({ ok: true, saleId, sha256: result.digest }, { headers: privateHeaders });
        } catch (error) {
            if (error instanceof PhotoError) return message(error.message, error.status);
            // Never log JWTs, student data, response bodies or private Blob URLs.
            console.error('Fotoğraf işlemi geçici olarak tamamlanamadı.');
            return message('Fotoğraf servisine ulaşılamadı; yeniden denenecek.', 503);
        }
    };
}
