import {
    collection,
    doc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    orderBy,
    runTransaction,
    serverTimestamp,
    writeBatch,
    onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { Urun, StokIslemTipi } from '@/types';

const COLLECTION_NAME = 'urunler';

function assertValidMoney(value: number | undefined, field: string) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${field} sıfır veya pozitif bir sayı olmalıdır.`);
    }
}

function assertValidStock(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error('Stok sıfır veya pozitif tam sayı olmalıdır.');
    }
}

export async function uploadProductImage(file: File): Promise<string | null> {
    try {
        const { compressImage } = await import('./imageUtils');
        // Resmi 400x400'e küçültüp JPEG olarak sıkıştır, base64 data URL döner
        const dataURL = await compressImage(file, 400, 400, 0.7);
        return dataURL;
    } catch (error) {
        console.error('Error processing product image:', error);
        return null;
    }
}

export async function getProducts(): Promise<Urun[]> {
    try {
        const q = query(collection(db, COLLECTION_NAME), orderBy('ad'));
        const querySnapshot = await getDocs(q);

        return querySnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        } as Urun));
    } catch (error) {
        console.error('Error fetching products:', error);
        return [];
    }
}

export function subscribeProducts(
    onProducts: (products: Urun[]) => void,
    onError: (error: Error) => void,
) {
    return onSnapshot(query(collection(db, COLLECTION_NAME), orderBy('ad')), snapshot => {
        onProducts(snapshot.docs.map(product => ({ id: product.id, ...product.data() } as Urun)));
    }, onError);
}

export async function addProduct(data: Omit<Urun, 'id' | 'olusturmaTarihi'>, islemYapan = 'Sistem Yöneticisi') {
    try {
        assertValidStock(data.stok);
        assertValidMoney(data.fiyat, 'Fiyat');
        assertValidMoney(data.maliyet, 'Maliyet');
        const docRef = doc(collection(db, COLLECTION_NAME));
        const batch = writeBatch(db);
        batch.set(docRef, {
            ...data,
            olusturmaTarihi: serverTimestamp(),
        });
        if (data.stok > 0) {
            batch.set(doc(collection(db, 'stok_hareketleri')), {
                urunId: docRef.id,
                urunAdi: data.ad,
                miktarDegisimi: data.stok,
                eskiStok: 0,
                yeniStok: data.stok,
                tarih: serverTimestamp(),
                islemTipi: 'Stok Ekleme / Giriş',
                islemYapan,
            });
        }
        await batch.commit();
        return { success: true, id: docRef.id };
    } catch (error: any) {
        console.error('Error adding product:', error);
        return { success: false, error: error.message };
    }
}

export async function updateProduct(id: string, data: Partial<Urun>) {
    try {
        if (data.stok !== undefined) {
            throw new Error('Stok doğrudan güncellenemez; stok defteri işlemi kullanılmalıdır.');
        }
        assertValidMoney(data.fiyat, 'Fiyat');
        assertValidMoney(data.maliyet, 'Maliyet');
        const docRef = doc(db, COLLECTION_NAME, id);
        await updateDoc(docRef, data);
        return { success: true };
    } catch (error: any) {
        console.error('Error updating product:', error);
        return { success: false, error: error.message };
    }
}

export async function deleteProduct(id: string) {
    try {
        await deleteDoc(doc(db, COLLECTION_NAME, id));
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting product:', error);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────────────────────────────
// updateStockWithLedger
// Wraps the stock update inside a Firestore Transaction to guarantee
// atomicity and creates an immutable audit entry in `stok_hareketleri`.
// ─────────────────────────────────────────────────────────────────────
export async function updateStockWithLedger(
    productId: string,
    newStok: number,
    islemYapan: string = 'Sistem Yöneticisi',
    expectedStok?: number,
) {
    try {
        assertValidStock(newStok);
        const productRef = doc(db, COLLECTION_NAME, productId);
        const ledgerRef = collection(db, 'stok_hareketleri');

        await runTransaction(db, async (transaction) => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw new Error('Product not found: ' + productId);

            const data = productSnap.data() as Urun;
            const eskiStok = data.stok ?? 0;
            assertValidStock(eskiStok);
            if (expectedStok !== undefined && eskiStok !== expectedStok) {
                throw new Error(`Stok siz düzenlerken değişti (güncel: ${eskiStok} adet). Güncel miktarı kontrol edip tekrar deneyin.`);
            }
            const diff = newStok - eskiStok;

            // No change — nothing to do
            if (diff === 0) return;

            const islemTipi: StokIslemTipi = diff > 0
                ? 'Stok Ekleme / Giriş'
                : 'Stok Düzeltme / Çıkış';

            // 1. Update the product document
            transaction.update(productRef, { stok: newStok });

            // 2. Write immutable ledger entry
            const ledgerDocRef = doc(ledgerRef);
            transaction.set(ledgerDocRef, {
                urunId: productId,
                urunAdi: data.ad,
                miktarDegisimi: diff,
                eskiStok,
                yeniStok: newStok,
                tarih: serverTimestamp(),
                islemTipi,
                islemYapan,
            });
        });

        return { success: true };
    } catch (error: any) {
        console.error('Stock ledger update error:', error);
        return { success: false, error: error.message };
    }
}

/** Teslim alınan adedi güncel stoğa ekler; satışlarla aynı anda güvenle çalışır. */
export async function addStockWithLedger(
    productId: string,
    quantity: number,
    islemYapan = 'Sistem Yöneticisi',
    operationId?: string,
) {
    try {
        assertValidStock(quantity);
        if (quantity === 0) throw new Error('Eklenen adet sıfırdan büyük olmalıdır.');
        const productRef = doc(db, COLLECTION_NAME, productId);
        const movements = collection(db, 'stok_hareketleri');
        const movementRef = operationId ? doc(movements, operationId) : doc(movements);
        await runTransaction(db, async transaction => {
            const previous = await transaction.get(movementRef);
            if (previous.exists()) {
                const saved = previous.data();
                if (saved.urunId !== productId || saved.miktarDegisimi !== quantity || saved.islemTipi !== 'Stok Ekleme / Giriş') {
                    throw new Error('Bu stok girişinin işlem kimliği başka bir kayıtta kullanılmış.');
                }
                return; // Yanıt kaybolup aynı giriş tekrar gönderilirse ikinci kez ekleme.
            }
            const product = await transaction.get(productRef);
            if (!product.exists()) throw new Error('Ürün bulunamadı.');
            const data = product.data() as Urun;
            const eskiStok = data.stok ?? 0;
            assertValidStock(eskiStok);
            const yeniStok = eskiStok + quantity;
            assertValidStock(yeniStok);
            transaction.update(productRef, { stok: yeniStok });
            transaction.set(movementRef, {
                urunId: productId, urunAdi: data.ad,
                miktarDegisimi: quantity, eskiStok, yeniStok,
                tarih: serverTimestamp(), islemTipi: 'Stok Ekleme / Giriş', islemYapan,
            });
        });
        return { success: true };
    } catch (error: any) {
        console.error('Stock receipt error:', error);
        return { success: false, error: error.message };
    }
}

/** Ürün formundaki alanları ve stok farkını tek transaction'da kaydeder. */
export async function updateProductWithStockLedger(
    productId: string,
    data: Partial<Urun>,
    islemYapan: string = 'Sistem Yöneticisi',
    expectedStok?: number,
) {
    try {
        if (data.stok === undefined) throw new Error('Yeni stok değeri eksik.');
        assertValidStock(data.stok);
        assertValidMoney(data.fiyat, 'Fiyat');
        assertValidMoney(data.maliyet, 'Maliyet');

        const productRef = doc(db, COLLECTION_NAME, productId);
        await runTransaction(db, async transaction => {
            const productSnap = await transaction.get(productRef);
            if (!productSnap.exists()) throw new Error('Güncellenecek ürün bulunamadı.');

            const current = productSnap.data() as Urun;
            const eskiStok = current.stok ?? 0;
            assertValidStock(eskiStok);
            // Ad/fiyat değiştirirken formun eski stok değerini sunucuya geri yazma.
            const stockChanged = expectedStok === undefined || data.stok !== expectedStok;
            if (stockChanged && expectedStok !== undefined && eskiStok !== expectedStok) {
                throw new Error(`Stok siz düzenlerken değişti (güncel: ${eskiStok} adet). Ürünü yeniden açıp miktarı kontrol edin.`);
            }
            const yeniStok = stockChanged ? data.stok! : eskiStok;
            const diff = yeniStok - eskiStok;
            transaction.update(productRef, { ...data, stok: yeniStok });

            if (diff !== 0) {
                transaction.set(doc(collection(db, 'stok_hareketleri')), {
                    urunId: productId,
                    urunAdi: data.ad ?? current.ad,
                    miktarDegisimi: diff,
                    eskiStok,
                    yeniStok,
                    tarih: serverTimestamp(),
                    islemTipi: diff > 0 ? 'Stok Ekleme / Giriş' : 'Stok Düzeltme / Çıkış',
                    islemYapan,
                });
            }
        });
        return { success: true };
    } catch (error: any) {
        console.error('Product + stock ledger update error:', error);
        return { success: false, error: error.message };
    }
}
