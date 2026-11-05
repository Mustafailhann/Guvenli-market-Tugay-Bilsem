'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { saveCategories, subscribeCategories } from '@/lib/categories';
import { categoryIcons, categoryKey, defaultCategorySettings, resolveCategories, type CategorySettings, type PosCategory } from '@/lib/category-model';
import { subscribeProducts } from '@/lib/products';
import type { Urun } from '@/types';

export default function CategoriesPage() {
    const [draft, setDraft] = useState<PosCategory[]>(defaultCategorySettings().categories);
    const [baseRevision, setBaseRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const dirtyRef = useRef(false);
    const latest = useRef<CategorySettings | null>(null);
    const [server, setServer] = useState<CategorySettings | null>(null);
    const [products, setProducts] = useState<Urun[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [settingsError, setSettingsError] = useState('');
    const [productsError, setProductsError] = useState('');
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState('');
    const [saveError, setSaveError] = useState('');

    useEffect(() => subscribeCategories(settings => {
        latest.current = settings;
        setServer(settings);
        setSettingsError('');
        if (!dirtyRef.current) {
            setDraft(settings.categories);
            setBaseRevision(settings.revision);
        }
    }, error => setSettingsError(error.message)), []);

    useEffect(() => subscribeProducts(data => {
        setProducts(data);
        setProductsLoading(false);
        setProductsError('');
    }, error => {
        setProductsLoading(false);
        setProductsError(error.message);
    }), []);

    const counts = new Map<string, number>();
    for (const product of products) {
        const key = categoryKey(product.kategori);
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const visible = resolveCategories(draft, counts.keys());
    const conflict = dirty && server !== null && server.revision !== baseRevision;
    const blocked = saving || !server || productsLoading || !!settingsError || !!productsError;

    function change(next: PosCategory[]) {
        dirtyRef.current = true;
        setDirty(true);
        setDraft(next);
        setMessage('');
        setSaveError('');
    }

    function edit(item: PosCategory, fields: Partial<PosCategory>) {
        const updated = { ...item, ...fields, key: item.key, active: true };
        change(draft.some(category => category.key === item.key)
            ? draft.map(category => category.key === item.key ? updated : category)
            : [...draft, updated]);
    }

    function move(index: number, offset: number) {
        const ordered = visible.map(item => ({ ...item, active: true }));
        [ordered[index], ordered[index + offset]] = [ordered[index + offset], ordered[index]];
        const visibleKeys = new Set(ordered.map(item => item.key));
        change([...ordered, ...draft.filter(item => !visibleKeys.has(item.key))]);
    }

    function remove(item: PosCategory) {
        if (counts.get(item.key)) return;
        change(server?.categories.some(category => category.key === item.key)
            ? draft.map(category => category.key === item.key ? { ...category, active: false } : category)
            : draft.filter(category => category.key !== item.key));
    }

    function reload() {
        if (!latest.current) return;
        dirtyRef.current = false;
        setDirty(false);
        setDraft(latest.current.categories);
        setBaseRevision(latest.current.revision);
        setSaveError('');
        setMessage('');
    }

    async function save() {
        if (blocked || conflict || !dirty) return;
        setSaving(true);
        setSaveError('');
        try {
            const visibleKeys = new Set(visible.map(item => item.key));
            const saved = await saveCategories([...visible, ...draft.filter(item => !visibleKeys.has(item.key))], baseRevision);
            const current = latest.current && latest.current.revision >= saved.revision ? latest.current : saved;
            latest.current = current;
            dirtyRef.current = false;
            setDirty(false);
            setDraft(current.categories);
            setBaseRevision(current.revision);
            setServer(current);
            setMessage('Kategoriler kaydedildi. İnternete bağlı güncel POS uygulamalarına otomatik yansır.');
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : 'Kategoriler kaydedilemedi.');
        } finally { setSaving(false); }
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-800">Kategoriler</h1>
                    <p className="text-sm text-gray-500 mt-1">Tablet ekranındaki kategori adlarını, simgelerini, renklerini ve sırasını düzenleyin.</p>
                </div>
                <button type="button" disabled={blocked || draft.length >= 200}
                    onClick={() => change([...draft, { key: `cat_${crypto.randomUUID()}`, name: '', icon: 'basket', color: '#2196F3', active: true }])}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg disabled:opacity-50">
                    Yeni Kategori Ekle
                </button>
            </div>

            {(settingsError || productsError || saveError) && <p role="alert" className="mb-4 p-4 rounded-lg bg-red-50 text-red-700">{settingsError || productsError || saveError}</p>}
            {message && <p role="status" className="mb-4 p-4 rounded-lg bg-green-50 text-green-700">{message}</p>}
            {conflict && <div role="alert" className="mb-4 p-4 rounded-lg bg-amber-50 text-amber-800">
                Kategoriler başka bir yönetici tarafından değiştirildi. Güncel ayarları yükleyip tekrar düzenleyin.
                <button type="button" onClick={reload} className="ml-3 underline font-semibold">Yeniden yükle</button>
            </div>}

            {!server ? <p role="status" className="text-gray-500">Kategoriler yükleniyor…</p> : (
                <div className="space-y-3">
                    {visible.map((item, index) => (
                        <section key={item.key} aria-label={`${item.name || 'Yeni kategori'} ayarları`}
                            className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm flex flex-wrap gap-4 items-end">
                            <div className="w-14 h-14 rounded-xl flex items-center justify-center text-3xl self-center shrink-0" style={{ backgroundColor: item.color }} aria-hidden="true">
                                <Image src={categoryIcons.find(icon => icon.value === item.icon)?.image || '/category-icons/basket.png'}
                                    alt="" width={48} height={48} unoptimized />
                            </div>
                            <div className="flex-1 min-w-40">
                                <label htmlFor={`category-name-${index}`} className="block text-sm font-medium text-gray-700 mb-1">Kategori adı</label>
                                <input id={`category-name-${index}`} maxLength={40} value={item.name} disabled={saving}
                                    onChange={event => edit(item, { name: event.target.value })}
                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900" />
                                <p className="text-xs text-gray-500 mt-1">{counts.get(item.key) || 0} ürün</p>
                            </div>
                            <div>
                                <label htmlFor={`category-icon-${index}`} className="block text-sm font-medium text-gray-700 mb-1">Simge</label>
                                <select id={`category-icon-${index}`} value={item.icon} disabled={saving} onChange={event => edit(item, { icon: event.target.value })}
                                    className="border border-gray-300 rounded-lg px-3 py-2 text-gray-900">
                                    {categoryIcons.map(icon => <option key={icon.value} value={icon.value}>{icon.label}</option>)}
                                </select>
                            </div>
                            <div>
                                <label htmlFor={`category-color-${index}`} className="block text-sm font-medium text-gray-700 mb-1">Renk</label>
                                <input id={`category-color-${index}`} type="color" value={item.color} disabled={saving}
                                    onInput={event => edit(item, { color: event.currentTarget.value.toUpperCase() })}
                                    className="h-10 w-16 border border-gray-300 rounded-lg cursor-pointer" />
                            </div>
                            <div className="flex gap-2 pb-5">
                                <button type="button" aria-label={`${item.name || 'Yeni kategori'} kategorisini yukarı taşı`} disabled={saving || index === 0}
                                    onClick={() => move(index, -1)} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 disabled:opacity-30">↑</button>
                                <button type="button" aria-label={`${item.name || 'Yeni kategori'} kategorisini aşağı taşı`} disabled={saving || index === visible.length - 1}
                                    onClick={() => move(index, 1)} className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 disabled:opacity-30">↓</button>
                                <button type="button" aria-label={`${item.name || 'Yeni kategori'} kategorisini sil`} disabled={saving || productsLoading || !!counts.get(item.key)}
                                    title={counts.get(item.key) ? 'Önce bu kategorideki ürünleri başka kategoriye taşıyın.' : 'Kategoriyi kaldır'}
                                    onClick={() => remove(item)} className="px-3 py-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-30">Sil</button>
                            </div>
                        </section>
                    ))}
                    {visible.length === 0 && <p className="bg-white p-6 rounded-xl border text-gray-500">Henüz kategori yok. Yeni kategori ekleyebilirsiniz.</p>}
                </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">Ürünü olan kategori silinemez. Tablette çevrimdışıyken son alınan ayarlar kullanılır.</p>
                <div className="flex gap-3">
                    <button type="button" onClick={reload} disabled={!dirty || saving} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 disabled:opacity-40">Vazgeç</button>
                    <button type="button" onClick={save} disabled={!dirty || blocked || conflict}
                        className="px-5 py-2 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40">
                        {saving ? 'Kaydediliyor…' : 'Değişiklikleri Kaydet'}
                    </button>
                </div>
            </div>
        </div>
    );
}
