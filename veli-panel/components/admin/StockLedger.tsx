'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { addStockWithLedger, subscribeProducts } from '@/lib/products';
import { StokHareketi, Urun } from '@/types';

export default function StockLedger({ islemYapan }: { islemYapan?: string }) {
    const [products, setProducts] = useState<Urun[]>([]);
    const [movements, setMovements] = useState<StokHareketi[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [productsError, setProductsError] = useState('');
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('all');
    const [productId, setProductId] = useState('');
    const [quantity, setQuantity] = useState('');
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState('');
    const [message, setMessage] = useState('');
    const savingRef = useRef(false);
    const operation = useRef<{ key: string; id: string } | null>(null);

    useEffect(() => subscribeProducts(setProducts, error => setProductsError(error.message)), []);

    useEffect(() => onSnapshot(
        query(collection(db, 'stok_hareketleri'), orderBy('tarih', 'desc')),
        snapshot => {
            setMovements(snapshot.docs.map(item => ({ ...item.data(), id: item.id } as StokHareketi)));
            setLoading(false);
            setError('');
        },
        error => {
            setLoading(false);
            setError(`Stok defteri yüklenemedi: ${error.message}`);
        },
    ), []);

    async function receiveStock(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (savingRef.current) return;
        const amount = Number(quantity);
        setMessage('');
        setSaveError('');
        if (!productId || !quantity.trim() || !Number.isSafeInteger(amount) || amount <= 0) {
            setSaveError('Bir ürün seçin ve sıfırdan büyük tam adet girin.');
            return;
        }
        const key = `${productId}:${amount}`;
        if (operation.current?.key !== key) {
            operation.current = { key, id: docId() };
        }
        savingRef.current = true;
        setSaving(true);
        try {
            const result = await addStockWithLedger(
                productId, amount,
                islemYapan || auth.currentUser?.displayName || auth.currentUser?.email || 'Sistem Yöneticisi',
                operation.current.id,
            );
            if (!result.success) throw new Error(result.error);
            operation.current = null;
            setQuantity('');
            setMessage(`${amount} adet stok girişi kaydedildi.`);
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Stok girişi kaydedilemedi.');
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    }

    const filtered = movements.filter(movement =>
        (movement.urunAdi ?? '').toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')) &&
        (kind === 'all' || (kind === 'in' ? movement.miktarDegisimi > 0 : movement.miktarDegisimi < 0)),
    );

    return (
        <div className="space-y-5">
            <form onSubmit={receiveStock} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Stok Girişi</h2>
                <p className="mt-1 text-sm text-slate-500">Teslim alınan adet mevcut stoğa eklenir. Tarih, miktar ve önceki/yeni stok deftere otomatik kaydedilir.</p>
                <div className="mt-4 flex flex-wrap items-end gap-3">
                    <label className="min-w-52 flex-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                        Ürün
                        <select required disabled={saving || !!productsError} value={productId} onChange={event => setProductId(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800">
                            <option value="">Ürün seçin</option>
                            {products.map(product => <option key={product.id} value={product.id}>{product.ad} — {product.stok} adet</option>)}
                        </select>
                    </label>
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Eklenen adet
                        <input required type="number" min="1" step="1" value={quantity} disabled={saving} onChange={event => setQuantity(event.target.value)} className="mt-1 block w-36 rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-600 dark:bg-slate-800" />
                    </label>
                    <button disabled={saving || !products.length || !!productsError} type="submit" className="rounded-lg bg-teal-600 px-5 py-2.5 font-semibold text-white hover:bg-teal-700 disabled:opacity-50">
                        {saving ? 'Kaydediliyor…' : 'Stoğa Ekle'}
                    </button>
                </div>
                {(saveError || productsError) && <p role="alert" className="mt-3 text-sm text-red-600">{saveError || `Ürünler yüklenemedi: ${productsError}`}</p>}
                {message && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{message}</p>}
            </form>

            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Stok Hareketleri</h2>
                    <p className="text-sm text-slate-500">Stok girişleri, düzeltmeler, satışlar ve iadeler · En yeni kayıt üstte</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <input type="search" aria-label="Stok defterinde ürün ara" placeholder="Ürün adına göre ara…" value={search} onChange={event => setSearch(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800" />
                    <select aria-label="Stok hareketi türü" value={kind} onChange={event => setKind(event.target.value)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800">
                        <option value="all">Tüm hareketler</option>
                        <option value="in">Stok girişleri / iadeler</option>
                        <option value="out">Satışlar / çıkışlar</option>
                    </select>
                </div>
            </div>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                {loading ? <p role="status" className="p-12 text-center text-slate-500">Stok defteri yükleniyor…</p> : !error && filtered.length === 0 ? (
                    <p className="p-12 text-center text-slate-500">{movements.length ? 'Bu filtrelerle eşleşen hareket yok.' : 'Henüz stok hareketi kaydedilmemiş.'}</p>
                ) : !error && (
                    <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800">
                            <tr>{['Tarih / Saat', 'Ürün', 'İşlem', 'Adet', 'Önceki Stok', 'Yeni Stok', 'İşlem Yapan'].map(label => <th key={label} className="whitespace-nowrap px-4 py-3">{label}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {filtered.map(movement => {
                                const date = movement.tarih?.toDate?.();
                                const incoming = movement.miktarDegisimi > 0;
                                return (
                                    <tr key={movement.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-500">{date ? date.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }) : 'Tarih onaylanıyor…'}</td>
                                        <td className="px-4 py-3 font-medium text-slate-800 dark:text-slate-100">{movement.urunAdi}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-300">{movement.islemTipi}</td>
                                        <td className={`px-4 py-3 font-bold ${incoming ? 'text-emerald-600' : 'text-rose-600'}`}>{incoming ? '+' : ''}{movement.miktarDegisimi}</td>
                                        <td className="px-4 py-3 text-slate-500">{movement.eskiStok}</td>
                                        <td className="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{movement.yeniStok}</td>
                                        <td className="px-4 py-3 text-slate-500">{movement.islemYapan || 'Sistem Yöneticisi'}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
                {!loading && !error && <p className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">{filtered.length} stok hareketi</p>}
            </div>
        </div>
    );
}

function docId() {
    return `giris_${crypto.randomUUID()}`;
}
