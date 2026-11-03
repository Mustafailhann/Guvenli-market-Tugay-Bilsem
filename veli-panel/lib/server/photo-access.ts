export class PhotoError extends Error {
    readonly status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

export type PhotoRecord = Record<string, unknown> & { id: string };
export interface PhotoActor { uid: string; admin?: boolean }
// Deliberately read-only: photo requests cannot write a sale, balance or stock.
export interface PhotoReader {
    get(collection: string, id: string): Promise<PhotoRecord | null>;
    query(collection: string, field: string, op: 'EQUAL' | 'ARRAY_CONTAINS', value: string): Promise<PhotoRecord[]>;
}

export const saleIdPattern = /^[A-Za-z0-9_-]{1,100}$/;

export function hasSalePhoto(record: Record<string, unknown>, saleId: string): boolean {
    return record.satisId === saleId && typeof record.islemFotografi === 'string' &&
        record.islemFotografi.endsWith(`/${saleId}.jpg`);
}

async function adminViewer(reader: PhotoReader, actor: PhotoActor) {
    const profiles = await reader.query('veliler', 'authID', 'EQUAL', actor.uid);
    return profiles.length === 1 && profiles[0].aktif !== false && profiles[0].role === 'admin';
}

export async function allowPhotoUpload(reader: PhotoReader, actor: PhotoActor, saleId: string) {
    const pos = await reader.get('pos_cihazlari', actor.uid);
    if (!pos || pos.aktif !== true) throw new PhotoError(403, 'Kayıtlı ve etkin POS gerekli.');
    const sale = await reader.get('satislar', saleId);
    if (!sale || sale.durum !== 'tamamlandi') throw new PhotoError(404, 'Satış henüz senkronize edilmedi.');
    if (sale.posUid !== actor.uid || !hasSalePhoto(sale, saleId) || typeof sale.ogrenciId !== 'string') {
        throw new PhotoError(403, 'Fotoğraf bu POS satışına ait değil.');
    }
}

export async function allowPhotoRead(reader: PhotoReader, actor: PhotoActor, saleId: string) {
    if (actor.admin === true) {
        if (!await adminViewer(reader, actor)) throw new PhotoError(403, 'Etkin yönetici kaydı gerekli.');
        const sale = await reader.get('satislar', saleId);
        if (!sale || sale.durum !== 'tamamlandi' || !hasSalePhoto(sale, saleId)) {
            throw new PhotoError(404, 'Satış fotoğrafı kaydı bulunamadı.');
        }
        return;
    }
    const mapping = await reader.get('parent_auth', actor.uid);
    if (!mapping || typeof mapping.veliId !== 'string') throw new PhotoError(403, 'Veli eşleştirmesi gerekli.');
    const viewer = await reader.get('veliler', mapping.veliId);
    if (!viewer || viewer.aktif === false || viewer.authID !== actor.uid) {
        throw new PhotoError(403, 'Etkin veli kaydı gerekli.');
    }
    // Existing rules allow only linked students. No sales-collection permission
    // or server service-account key is needed for a parent's photo request.
    const students = await reader.query('ogrenciler', 'veliIDleri', 'ARRAY_CONTAINS', viewer.id);
    const ownPhoto = students.some(student => Array.isArray(student.veliIDleri) &&
        student.veliIDleri.includes(viewer.id) && Array.isArray(student.islemGecmisi) &&
        student.islemGecmisi.some(item => item && typeof item === 'object' && hasSalePhoto(item, saleId)));
    if (!ownPhoto) throw new PhotoError(403, 'Bu satış fotoğrafına erişiminiz yok.');
}
