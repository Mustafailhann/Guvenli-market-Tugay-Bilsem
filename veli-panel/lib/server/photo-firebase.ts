import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { PhotoError, type PhotoActor, type PhotoReader, type PhotoRecord } from './photo-access.ts';

export function photoProjectId() {
    const id = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    if (!id || !/^[a-z][a-z0-9-]{4,62}$/.test(id)) throw new PhotoError(503, 'Firebase projesi yapılandırılmadı.');
    return id;
}

export async function checkPhotoSession(token: string, uid: string, authTime: number, fetcher = fetch) {
    const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    if (!apiKey) throw new PhotoError(503, 'Firebase oturumu yapılandırılmadı.');
    const response = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
        cache: 'no-store', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new PhotoError(response.status >= 500 || response.status === 429 ? 503 : 401, 'Oturum doğrulanamadı.');
    const body = await response.json();
    const user = body.users?.length === 1 ? body.users[0] : null;
    if (!user || user.localId !== uid || user.disabled === true ||
        (user.validSince && authTime < Number(user.validSince))) {
        throw new PhotoError(401, 'Oturum iptal edilmiş. Yeniden giriş gerekli.');
    }
}

export async function verifyPhotoToken(token: string): Promise<PhotoActor> {
    const appName = 'sale-photo-token-verifier';
    const app = getApps().find(item => item.name === appName) ||
        initializeApp({ projectId: photoProjectId() }, appName);
    try {
        // Verifies public signing certificates; no private service-account key.
        const decoded = await getAuth(app).verifyIdToken(token);
        await checkPhotoSession(token, decoded.uid, decoded.auth_time);
        return { uid: decoded.uid, admin: decoded.admin === true };
    } catch (error) {
        if (error instanceof PhotoError) throw error;
        throw new PhotoError(401, 'Oturum geçersiz veya süresi dolmuş.');
    }
}

type FirestoreValue = {
    stringValue?: string; integerValue?: string; doubleValue?: number; booleanValue?: boolean;
    nullValue?: null; timestampValue?: string; arrayValue?: { values?: FirestoreValue[] };
    mapValue?: { fields?: Record<string, FirestoreValue> };
};

export function decodeFields(fields: Record<string, FirestoreValue> = {}): Record<string, unknown> {
    const value = (v: FirestoreValue): unknown => {
        if ('stringValue' in v) return v.stringValue;
        if ('integerValue' in v) return Number(v.integerValue);
        if ('doubleValue' in v) return v.doubleValue;
        if ('booleanValue' in v) return v.booleanValue;
        if ('timestampValue' in v) return v.timestampValue;
        if ('arrayValue' in v) return (v.arrayValue?.values || []).map(value);
        if ('mapValue' in v) return decodeFields(v.mapValue?.fields);
        return null;
    };
    return Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, value(v)]));
}

export function createPhotoReader(token: string, projectId = photoProjectId(), fetcher = fetch): PhotoReader {
    const origin = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
    async function read(url: string, query?: object) {
        const response = await fetcher(url, {
            method: query ? 'POST' : 'GET',
            headers: { Authorization: `Bearer ${token}`, ...(query ? { 'Content-Type': 'application/json' } : {}) },
            ...(query ? { body: JSON.stringify({ structuredQuery: query }) } : {}),
            cache: 'no-store', signal: AbortSignal.timeout(10000),
        });
        if (response.status === 404) return null;
        if (response.status === 401 || response.status === 403) throw new PhotoError(response.status, 'Fotoğraf erişimi doğrulanamadı.');
        if (!response.ok) throw new PhotoError(503, 'Firebase doğrulama servisine ulaşılamadı.');
        return response.json();
    }
    function document(item: { name: string; fields?: Record<string, FirestoreValue> }): PhotoRecord {
        return { ...decodeFields(item.fields), id: item.name.split('/').pop()! };
    }
    return {
        async get(collection, id) {
            if (!/^[a-z_]+$/.test(collection) || !id || id.includes('/')) throw new PhotoError(400, 'Geçersiz kayıt kimliği.');
            const result = await read(`${origin}/${collection}/${encodeURIComponent(id)}`);
            return result ? document(result) : null;
        },
        async query(collection, field, op, value) {
            const result = await read(`${origin}:runQuery`, {
                from: [{ collectionId: collection }],
                where: { fieldFilter: { field: { fieldPath: field }, op, value: { stringValue: value } } },
                ...(collection === 'veliler' ? { limit: 2 } : {}),
            });
            return (result || []).filter((item: { document?: unknown }) => item.document)
                .map((item: { document: Parameters<typeof document>[0] }) => document(item.document));
        },
    };
}
