import { collection, doc, getDocs, limit, onSnapshot, query, runTransaction, serverTimestamp, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { categorySettingsPath, parseCategorySettings, validateCategories, type CategorySettings, type PosCategory } from './category-model.ts';

export function subscribeCategories(onChange: (settings: CategorySettings) => void, onError: (error: Error) => void) {
    return onSnapshot(doc(db, 'app_settings', categorySettingsPath), snapshot => {
        try { onChange(parseCategorySettings(snapshot.exists() ? snapshot.data() : null)); }
        catch (error) { onError(error instanceof Error ? error : new Error('Kategoriler okunamadı.')); }
    }, onError);
}

export async function saveCategories(input: PosCategory[], expectedRevision: number): Promise<CategorySettings> {
    const categories = validateCategories(input);
    if (!auth.currentUser) throw new Error('Yeniden giriş yapın.');
    const uid = auth.currentUser.uid;
    const ref = doc(db, 'app_settings', categorySettingsPath);
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const current = parseCategorySettings(snapshot.exists() ? snapshot.data() : null);
        if (current.revision !== expectedRevision) throw new Error('Kategoriler başka bir yönetici tarafından değiştirildi. Yeniden yükleyin.');
        if (current.categories.some(item => !categories.some(next => next.key === item.key))) {
            throw new Error('Mevcut kategorilerin ürün bağlantısı değiştirilemez.');
        }
        // Only newly removed categories need a usage check. A concurrent legacy
        // assignment is still displayed by resolveCategories on web and POS.
        for (const old of current.categories.filter(item => item.active)) {
            const next = categories.find(item => item.key === old.key)!;
            if (next.active) continue;
            const used = await getDocs(query(collection(db, 'urunler'), where('kategori', '==', old.key), limit(1)));
            if (!used.empty) throw new Error(`“${old.name}” kategorisinde ürün var. Önce ürünleri başka kategoriye taşıyın.`);
        }
        if (auth.currentUser?.uid !== uid) throw new Error('Oturum değişti. Yeniden giriş yapın.');
        const saved = { revision: current.revision + 1, categories };
        transaction.set(ref, { schemaVersion: 1, ...saved, updatedAt: serverTimestamp(), updatedBy: uid });
        return saved;
    });
}
