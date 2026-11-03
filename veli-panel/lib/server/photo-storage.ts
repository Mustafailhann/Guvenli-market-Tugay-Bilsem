import { get, put } from '@vercel/blob';
import { createHash } from 'node:crypto';
import { PhotoError, saleIdPattern } from './photo-access.ts';

export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const photoDigest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

export function photoPath(projectId: string, saleId: string) {
    if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId) || !saleIdPattern.test(saleId)) throw new PhotoError(400, 'Geçersiz fotoğraf kimliği.');
    return `sale-photos/${projectId}/${saleId}.jpg`;
}

export function normalizeJpeg(bytes: Uint8Array) {
    if (bytes.length < 4 || bytes.length > MAX_PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new PhotoError(bytes.length > MAX_PHOTO_BYTES ? 413 : 400, 'Geçersiz JPEG.');
    }
    // Android JPEGs may contain a short vendor trailer after the EOI marker.
    for (let i = bytes.length - 2; i >= Math.max(2, bytes.length - 65538); i--) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return bytes.slice(0, i + 2);
    }
    throw new PhotoError(400, 'JPEG dosyası tamamlanmamış.');
}

export interface PhotoStore {
    read(path: string): Promise<Uint8Array | null>;
    create(path: string, bytes: Uint8Array): Promise<void>;
}

export const privatePhotoStore: PhotoStore = {
    async read(path) {
        const result = await get(path, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(15000) });
        if (!result) return null;
        if (result.statusCode !== 200 || result.blob.contentType !== 'image/jpeg' || result.blob.size > MAX_PHOTO_BYTES) {
            throw new PhotoError(502, 'Depodaki fotoğraf geçersiz.');
        }
        return new Uint8Array(await new Response(result.stream).arrayBuffer());
    },
    async create(path, bytes) {
        await put(path, Buffer.from(bytes), {
            access: 'private', addRandomSuffix: false, allowOverwrite: false,
            contentType: 'image/jpeg', abortSignal: AbortSignal.timeout(20000),
        });
    },
};

export async function savePhotoOnce(store: PhotoStore, path: string, bytes: Uint8Array) {
    const digest = photoDigest(bytes);
    const existing = await store.read(path);
    if (existing) {
        if (photoDigest(existing) !== digest) throw new PhotoError(409, 'Bu satışın fotoğrafı zaten farklı içerikle kayıtlı.');
        return { digest, duplicate: true };
    }
    try {
        await store.create(path, bytes);
    } catch (error) {
        // Simultaneous retries on different server instances keep one immutable key.
        const raced = await store.read(path);
        if (!raced) throw error;
        if (photoDigest(raced) !== digest) throw new PhotoError(409, 'Fotoğraf çakışması.');
        return { digest, duplicate: true };
    }
    return { digest, duplicate: false };
}
