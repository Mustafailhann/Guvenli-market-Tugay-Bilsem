'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getProducts, updateProduct, updateStockWithLedger } from '@/lib/products';
import { Urun, StokHareketi } from '@/types';
import { addKasaGideri, getKasaGiderleri, GiderTuru, KasaGideri, getRealizedPnlData, PnlResult } from '@/lib/admin';
import { db, auth } from '@/lib/firebase';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';

// ────────────────────────────────────────────────────────────────
// Helper — format currency in Turkish Lira
// ────────────────────────────────────────────────────────────────
function fmt(value: number) {
    return value.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

// ────────────────────────────────────────────────────────────────
// MetricCard
// ────────────────────────────────────────────────────────────────
interface MetricCardProps {
    title: string;
    value: string;
    subtitle: string;
    gradient: string;
    icon: React.ReactNode;
}

function MetricCard({ title, value, subtitle, gradient, icon }: MetricCardProps) {
    return (
        <div className={`relative overflow-hidden rounded-2xl p-6 text-white shadow-lg ${gradient}`}>
            <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
            <div className="absolute -bottom-8 -right-2 h-20 w-20 rounded-full bg-white/5" />
            <div className="relative z-10 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold uppercase tracking-widest text-white/70">{title}</p>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20">{icon}</div>
                </div>
                <p className="text-3xl font-extrabold tracking-tight">{value}</p>
                <p className="text-xs text-white/60">{subtitle}</p>
            </div>
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// InlineNumInput — seamless editable cell input
// ────────────────────────────────────────────────────────────────
interface InlineNumInputProps {
    value: number;         // current local (optimistic) number value
    isSaving: boolean;     // shows spinner ring while Firestore write is pending
    min?: number;
    step?: number;
    onCommit: (val: number) => void; // called on blur / Enter
}

function InlineNumInput({ value, isSaving, min = 0, step = 0.01, onCommit }: InlineNumInputProps) {
    // internal string state so user can freely type decimals/clear
    const [localStr, setLocalStr] = useState(value.toString());
    const inputRef = useRef<HTMLInputElement>(null);

    // sync when external value changes (e.g. after a save re-hydrates)
    useEffect(() => {
        // only update if not focused to avoid clobbering user's in-progress typing
        if (document.activeElement !== inputRef.current) {
            setLocalStr(value.toString());
        }
    }, [value]);

    const commit = useCallback(() => {
        const parsed = parseFloat(localStr);
        const safe = isNaN(parsed) ? 0 : Math.max(min, parsed);
        // Sync local text back to the clean number (avoids "trailing dot" residue)
        setLocalStr(safe.toString());
        if (safe !== value) onCommit(safe);
    }, [localStr, value, min, onCommit]);

    return (
        <div className="relative flex items-center justify-end group">
            <input
                ref={inputRef}
                type="number"
                min={min}
                step={step}
                value={localStr}
                onChange={e => setLocalStr(e.target.value)}
                onBlur={commit}
                onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); }
                    if (e.key === 'Escape') { setLocalStr(value.toString()); inputRef.current?.blur(); }
                }}
                className={`
                    w-24 rounded-lg border py-1 px-2 text-right text-sm font-medium
                    outline-none transition-all duration-150
                    ${isSaving
                        ? 'text-slate-400 border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                        : 'text-slate-700 border-transparent bg-transparent hover:border-slate-200 hover:bg-slate-50 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-400/20 dark:text-slate-200 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:focus:border-emerald-500 dark:focus:bg-slate-900'
                    }
                `}
                disabled={isSaving}
                aria-label="Düzenle"
            />
            {/* pencil micro-hint — visible on row hover, hidden on focus */}
            {!isSaving && (
                <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-300 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-0 dark:text-slate-600">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                            d="M15.232 5.232l3.536 3.536M9 11l6.5-6.5a2.121 2.121 0 013 3L12 14H9v-3z" />
                    </svg>
                </span>
            )}
            {/* saving spinner */}
            {isSaving && (
                <span className="absolute -right-4 top-1/2 -translate-y-1/2">
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                </span>
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────
// GIDER_TURLERI constants
// ────────────────────────────────────────────────────────────────
const GIDER_TURLERI: GiderTuru[] = [
    'Müdüre Kasa Teslimi',
    'Benzin / Lojistik',
    'Diğer İşletme Gideri',
];

const GIDER_COLORS: Record<GiderTuru, string> = {
    'Müdüre Kasa Teslimi': 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    'Benzin / Lojistik': 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    'Diğer İşletme Gideri': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

// ────────────────────────────────────────────────────────────────
// Local editable values per product
// ────────────────────────────────────────────────────────────────
interface EditValues {
    stok: number;
    maliyet: number;
    fiyat: number;
}

type Tab = 'stok' | 'kasa' | 'pnl' | 'defteri' | 'mutabakat';

interface OfflineMutabakat {
    id: string;
    satisId: string;
    ogrenciAdi?: string;
    kartID?: string;
    toplamTutar: number;
    hata?: string;
    yerelTarih?: string;
    bildirimTarihi?: Timestamp | { seconds: number };
    urunler?: Array<{ ad: string; miktar: number }>;
}

// ────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────
// PnlSkeletonCard — loading placeholder
// ────────────────────────────────────────────────────────────────
function PnlSkeletonCard() {
    return (
        <div className="animate-pulse rounded-2xl bg-slate-200 dark:bg-slate-800 p-6 h-32" />
    );
}

// ────────────────────────────────────────────────────────────────
// Main Page
// ────────────────────────────────────────────────────────────────
export default function FinansPage() {
    const [activeTab, setActiveTab] = useState<Tab>('stok');

    // ── Products & inline-edit state ──────────────────────────
    const [products, setProducts] = useState<Urun[]>([]);
    const [loadingProducts, setLoadingProducts] = useState(true);

    // Optimistic local values: id → {stok, maliyet, fiyat}
    const [editValues, setEditValues] = useState<Record<string, EditValues>>({});

    // Which product IDs are currently being saved to Firestore
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

    const [searchTerm, setSearchTerm] = useState('');
    const [sortKey, setSortKey] = useState<'ad' | 'stok' | 'maliyet' | 'fiyat' | 'toplamMaliyet' | 'toplamCiro' | 'kar'>('kar');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // ── Kasa & Giderler state ─────────────────────────────────
    const [giderler, setGiderler] = useState<KasaGideri[]>([]);
    const [loadingGiderler, setLoadingGiderler] = useState(true);
    const [giderTuru, setGiderTuru] = useState<GiderTuru>('Müdüre Kasa Teslimi');
    const [giderTutar, setGiderTutar] = useState('');
    const [giderAciklama, setGiderAciklama] = useState('');
    const [savingGider, setSavingGider] = useState(false);

    // ── Realized P&L state ────────────────────────────────────
    const [pnlData, setPnlData] = useState<PnlResult | null>(null);
    const [loadingPnl, setLoadingPnl] = useState(false);
    const [pnlFetched, setPnlFetched] = useState(false);

    // ── Stok Defteri (Ledger) state ──────────────────────────────
    const [stokHareketleri, setStokHareketleri] = useState<StokHareketi[]>([]);
    const [loadingLedger, setLoadingLedger] = useState(false);
    const [ledgerSearch, setLedgerSearch] = useState('');
    const [mutabakatlar, setMutabakatlar] = useState<OfflineMutabakat[]>([]);
    const [loadingMutabakat, setLoadingMutabakat] = useState(true);

    // ── Admin identity for audit trail ───────────────────────────
    const [adminAdSoyad, setAdminAdSoyad] = useState('Sistem Yöneticisi');

    // ── Load products ─────────────────────────────────────────
    useEffect(() => {
        (async () => {
            setLoadingProducts(true);
            const data = await getProducts();
            setProducts(data);
            // Seed editValues from fetched products
            const initial: Record<string, EditValues> = {};
            data.forEach(p => {
                initial[p.id] = { stok: p.stok ?? 0, maliyet: p.maliyet ?? 0, fiyat: p.fiyat ?? 0 };
            });
            setEditValues(initial);
            setLoadingProducts(false);
        })();
        fetchGiderler();
    }, []);

    // -- Resolve admin name from Firebase Auth
    useEffect(() => {
        const unsubscribeAuth = onAuthStateChanged(auth, async (user) => {
            if (!user) return;
            try {
                const snap = await getDoc(doc(db, 'veliler', user.uid));
                if (snap.exists()) {
                    const d = snap.data();
                    setAdminAdSoyad(d.adSoyad || d.email || user.email || 'Sistem Yoneticisi');
                } else {
                    setAdminAdSoyad(user.email ?? 'Sistem Yoneticisi');
                }
            } catch {
                setAdminAdSoyad('Sistem Yoneticisi');
            }
        });
        return () => unsubscribeAuth();
    }, []);

    // -- Real-time Stok Defteri listener (lazy -- only when tab opened)
    useEffect(() => {
        if (activeTab !== 'defteri') return;
        setLoadingLedger(true);
        const q = query(collection(db, 'stok_hareketleri'), orderBy('tarih', 'desc'));
        const unsub = onSnapshot(q, (snap) => {
            setStokHareketleri(
                snap.docs.map(d => ({ id: d.id, ...d.data() } as StokHareketi))
            );
            setLoadingLedger(false);
        });
        return () => unsub();
    }, [activeTab]);

    // Offline POS çakışmaları muhasebeden gizlenmez; gerçek zamanlı gösterilir.
    useEffect(() => {
        const q = query(collection(db, 'offline_mutabakatlar'), orderBy('bildirimTarihi', 'desc'));
        const unsub = onSnapshot(q, snap => {
            setMutabakatlar(snap.docs.map(d => ({ id: d.id, ...d.data() } as OfflineMutabakat)));
            setLoadingMutabakat(false);
        }, error => {
            console.error('Offline mutabakat listener error:', error);
            setLoadingMutabakat(false);
        });
        return () => unsub();
    }, []);


    useEffect(() => {
        if (activeTab === 'pnl' && !pnlFetched) {
            setLoadingPnl(true);
            setPnlFetched(true);
            getRealizedPnlData().then(data => {
                setPnlData(data);
                setLoadingPnl(false);
            });
        }
    }, [activeTab, pnlFetched]);

    const refreshPnl = () => {
        setLoadingPnl(true);
        setPnlFetched(true);
        getRealizedPnlData().then(data => {
            setPnlData(data);
            setLoadingPnl(false);
        });
    };

    const fetchGiderler = async () => {
        setLoadingGiderler(true);
        const data = await getKasaGiderleri();
        setGiderler(data);
        setLoadingGiderler(false);
    };

    // -- Commit a single field to Firestore
    // Called ONLY on blur or Enter -- never on keystroke.
    const handleCellCommit = useCallback(async (
        productId: string,
        field: keyof EditValues,
        newValue: number
    ) => {
        // Optimistically update local state immediately
        setEditValues(prev => ({
            ...prev,
            [productId]: { ...prev[productId], [field]: newValue }
        }));

        // Mark as saving
        setSavingIds(prev => new Set(prev).add(productId));

        try {
            if (field === 'stok') {
                // Ledger transaction: reads current stock, diffs, writes audit record
                const result = await updateStockWithLedger(productId, newValue, adminAdSoyad);
                if (!result.success) throw new Error(result.error);
            } else {
                // Maliyet / fiyat: simple update, no ledger needed
                const result = await updateProduct(productId, { [field]: newValue });
                if (!result.success) throw new Error(result.error);
            }
        } catch (err) {
            console.error('Inline edit save error:', err);
            const fresh = await getProducts();
            setProducts(fresh);
            setEditValues(Object.fromEntries(fresh.map(p => [p.id, {
                stok: p.stok ?? 0,
                maliyet: p.maliyet ?? 0,
                fiyat: p.fiyat ?? 0,
            }])));
            alert(err instanceof Error ? err.message : 'Değişiklik kaydedilemedi.');
        } finally {
            setSavingIds(prev => {
                const next = new Set(prev);
                next.delete(productId);
                return next;
            });
        }
    }, [adminAdSoyad]);


    // ── Stok derived metrics — reads from editValues for optimistic UI ──
    const { toplamStokMaliyeti, toplamPotansiyelCiro, netBeklenenKar, rows } = useMemo(() => {
        let toplamStokMaliyeti = 0;
        let toplamPotansiyelCiro = 0;

        const rows = products.map(p => {
            const ev = editValues[p.id];
            const maliyet = ev?.maliyet ?? p.maliyet ?? 0;
            const fiyat   = ev?.fiyat   ?? p.fiyat   ?? 0;
            const stok    = ev?.stok    ?? p.stok    ?? 0;

            const toplamMaliyet = maliyet * stok;
            const toplamCiro    = fiyat   * stok;
            const kar           = toplamCiro - toplamMaliyet;

            toplamStokMaliyeti  += toplamMaliyet;
            toplamPotansiyelCiro += toplamCiro;

            return { ...p, maliyet, fiyat, stok, toplamMaliyet, toplamCiro, kar };
        });

        return {
            toplamStokMaliyeti,
            toplamPotansiyelCiro,
            netBeklenenKar: toplamPotansiyelCiro - toplamStokMaliyeti,
            rows,
        };
    }, [products, editValues]);

    // ── Kasa metrics ─────────────────────────────────────────
    const toplamKasaGideri = useMemo(() => giderler.reduce((s, g) => s + g.tutar, 0), [giderler]);

    // ── Table filter / sort ───────────────────────────────────
    const filteredAndSorted = useMemo(() => {
        const lower = searchTerm.toLowerCase();
        const filtered = rows.filter(r => r.ad.toLowerCase().includes(lower));
        return [...filtered].sort((a, b) => {
            let aVal: number | string = a[sortKey] ?? 0;
            let bVal: number | string = b[sortKey] ?? 0;
            if (sortKey === 'ad') {
                aVal = a.ad.toLocaleLowerCase('tr-TR');
                bVal = b.ad.toLocaleLowerCase('tr-TR');
            }
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [rows, searchTerm, sortKey, sortDir]);

    const handleSort = (key: typeof sortKey) => {
        if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortKey(key); setSortDir('desc'); }
    };

    const SortIcon = ({ k }: { k: typeof sortKey }) => {
        if (sortKey !== k) return <span className="ml-1 opacity-30">↕</span>;
        return <span className="ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
    };

    const Th = ({ label, k, align = 'right', editable }: { label: string; k: typeof sortKey; align?: 'left' | 'right'; editable?: boolean }) => (
        <th
            className={`px-4 py-3 text-xs font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap text-${align} transition-colors
                ${editable
                    ? 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                }`}
            onClick={() => handleSort(k)}
        >
            {editable && (
                <svg className="inline-block mr-1 h-3 w-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.586 2.586a2 2 0 112.828 2.828L12 14.828 9 15l.172-3L18.586 2.586z" />
                </svg>
            )}
            {label}<SortIcon k={k} />
        </th>
    );

    // ── Gider form submit ─────────────────────────────────────
    const handleAddGider = async (e: React.FormEvent) => {
        e.preventDefault();
        const tutar = parseFloat(giderTutar);
        if (isNaN(tutar) || tutar <= 0) return;
        setSavingGider(true);
        try {
            const result = await addKasaGideri({ giderTuru, tutar, aciklama: giderAciklama });
            if (result.success) {
                setGiderTutar('');
                setGiderAciklama('');
                fetchGiderler();
            } else {
                alert('Hata: ' + result.error);
            }
        } finally {
            setSavingGider(false);
        }
    };

    const loading = loadingProducts && loadingGiderler;

    // ────────────────────────────────────────────────────────
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-6">

            {/* ── Page Header ── */}
            <div className="mb-6 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/30">
                    <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4v16a1 1 0 001 1h14a1 1 0 001-1V4" />
                    </svg>
                </div>
                <div>
                    <h1 className="text-2xl font-extrabold text-slate-800 dark:text-white">Finansal &amp; Kar Analizi</h1>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Stok maliyeti, potansiyel ciro, net kar ve kasa gideri takibi</p>
                </div>
            </div>

            {loading ? (
                <div className="flex h-64 items-center justify-center">
                    <div className="h-12 w-12 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
                </div>
            ) : (
                <>
                    {/* ── Global Summary Cards (4 cards) ── */}
                    <div className="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                        <MetricCard
                            title="Toplam Stok Maliyeti"
                            value={fmt(toplamStokMaliyeti)}
                            subtitle="Σ ( birim maliyet × stok )"
                            gradient="bg-gradient-to-br from-slate-700 to-slate-900"
                            icon={
                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                </svg>
                            }
                        />
                        <MetricCard
                            title="Toplam Potansiyel Ciro"
                            value={fmt(toplamPotansiyelCiro)}
                            subtitle="Σ ( satış fiyatı × stok )"
                            gradient="bg-gradient-to-br from-blue-500 to-indigo-700"
                            icon={
                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                            }
                        />
                        <MetricCard
                            title="Net Beklenen Kâr"
                            value={fmt(netBeklenenKar)}
                            subtitle="Toplam Ciro − Toplam Maliyet"
                            gradient={netBeklenenKar >= 0 ? 'bg-gradient-to-br from-emerald-500 to-teal-700' : 'bg-gradient-to-br from-red-500 to-rose-700'}
                            icon={
                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                </svg>
                            }
                        />
                        <MetricCard
                            title="Toplam Çıkan Nakit / Gider"
                            value={fmt(toplamKasaGideri)}
                            subtitle={`${giderler.length} gider kaydı`}
                            gradient="bg-gradient-to-br from-rose-600 to-red-800"
                            icon={
                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                </svg>
                            }
                        />
                    </div>

                    {/* ── Tabs ── */}
                    <div className="mb-6 flex gap-1 rounded-xl bg-slate-200/60 p-1 dark:bg-slate-800 w-fit flex-wrap">
                        <button
                            onClick={() => setActiveTab('stok')}
                            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
                                activeTab === 'stok'
                                    ? 'bg-white text-slate-800 shadow dark:bg-slate-700 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            📦 Stok &amp; Ürün Analizi
                        </button>
                        <button
                            onClick={() => setActiveTab('kasa')}
                            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
                                activeTab === 'kasa'
                                    ? 'bg-white text-slate-800 shadow dark:bg-slate-700 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            💵 Kasa ve Giderler
                        </button>
                        <button
                            onClick={() => setActiveTab('pnl')}
                            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
                                activeTab === 'pnl'
                                    ? 'bg-white text-slate-800 shadow dark:bg-slate-700 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            📈 Gerçekleşen Kâr/Zarar
                        </button>
                        <button
                            onClick={() => setActiveTab('defteri')}
                            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
                                activeTab === 'defteri'
                                    ? 'bg-white text-slate-800 shadow dark:bg-slate-700 dark:text-white'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            📋 Stok Defteri
                        </button>
                        <button
                            onClick={() => setActiveTab('mutabakat')}
                            className={`rounded-lg px-5 py-2 text-sm font-semibold transition-all ${
                                activeTab === 'mutabakat'
                                    ? 'bg-white text-red-700 shadow dark:bg-slate-700 dark:text-red-300'
                                    : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                            }`}
                        >
                            ⚠️ Offline Mutabakat{mutabakatlar.length > 0 ? ` (${mutabakatlar.length})` : ''}
                        </button>
                    </div>

                    {/* ══════════ TAB: STOK ANALİZİ ══════════ */}
                    {activeTab === 'stok' && (
                        <>
                            {/* Search bar + legend */}
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                                <div className="relative max-w-sm flex-1">
                                    <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Ürün ara..."
                                        value={searchTerm}
                                        onChange={e => setSearchTerm(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 shadow-sm outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-emerald-500"
                                    />
                                </div>
                                {/* Inline-edit legend */}
                                <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-400">
                                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"
                                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18.586 2.586a2 2 0 112.828 2.828L12 14.828 9 15l.172-3L18.586 2.586z" />
                                    </svg>
                                    <span>Yeşil sütunlar düzenlenebilir — tıklayın ve Enter / Tab ile onaylayın</span>
                                </div>
                            </div>

                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                                        <thead className="bg-slate-50 dark:bg-slate-800">
                                            <tr>
                                                {/* Read-only columns */}
                                                <Th label="Ürün Adı" k="ad" align="left" />
                                                {/* Editable columns — marked with pencil icon in header */}
                                                <Th label="Mevcut Stok"       k="stok"          editable />
                                                <Th label="Birim Maliyet"     k="maliyet"       editable />
                                                <Th label="Birim Satış Fiyatı" k="fiyat"        editable />
                                                {/* Read-only derived columns */}
                                                <Th label="Toplam Maliyet"    k="toplamMaliyet" />
                                                <Th label="Toplam Ciro"       k="toplamCiro"    />
                                                <th
                                                    className="cursor-pointer select-none whitespace-nowrap px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-emerald-700 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-300 transition-colors"
                                                    onClick={() => handleSort('kar')}
                                                >
                                                    Ürün Bazlı Kâr<SortIcon k="kar" />
                                                </th>
                                            </tr>
                                        </thead>

                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                            {filteredAndSorted.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="py-12 text-center text-slate-400 dark:text-slate-500">Ürün bulunamadı</td>
                                                </tr>
                                            ) : (
                                                filteredAndSorted.map((row, idx) => {
                                                    const isSaving = savingIds.has(row.id);
                                                    const karPositive = row.kar >= 0;
                                                    const ev = editValues[row.id] ?? { stok: row.stok, maliyet: row.maliyet, fiyat: row.fiyat };

                                                    return (
                                                        <tr
                                                            key={row.id}
                                                            className={`group transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                                                                idx % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'
                                                            }`}
                                                        >
                                                            {/* ── Ürün Adı (read-only) ── */}
                                                            <td className="px-4 py-2.5">
                                                                <div className="flex items-center gap-3">
                                                                    {row.resimURL ? (
                                                                        <img src={row.resimURL} alt={row.ad}
                                                                            className="h-9 w-9 flex-shrink-0 rounded-lg object-contain border border-slate-100 dark:border-slate-700 bg-white" />
                                                                    ) : (
                                                                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-700">
                                                                            <svg className="h-4 w-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                                            </svg>
                                                                        </div>
                                                                    )}
                                                                    <div>
                                                                        <p className="font-medium text-slate-800 dark:text-slate-100">{row.ad}</p>
                                                                        {row.kategori && <p className="text-xs text-slate-400">{row.kategori}</p>}
                                                                    </div>
                                                                </div>
                                                            </td>

                                                            {/* ── Mevcut Stok (editable) ── */}
                                                            <td className="px-3 py-1.5 text-right">
                                                                <InlineNumInput
                                                                    value={ev.stok}
                                                                    isSaving={isSaving}
                                                                    min={0}
                                                                    step={1}
                                                                    onCommit={val => handleCellCommit(row.id, 'stok', val)}
                                                                />
                                                                {/* stock status badge below input */}
                                                                <div className="mt-0.5 text-right">
                                                                    <span className={`inline-block rounded-full px-2 py-px text-[10px] font-semibold ${
                                                                        ev.stok === 0
                                                                            ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400'
                                                                            : ev.stok <= 15
                                                                            ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
                                                                            : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                                                                    }`}>
                                                                        {ev.stok === 0 ? '🚫 Tükendi' : ev.stok <= 15 ? '⚠️ Az' : 'Yeterli'}
                                                                    </span>
                                                                </div>
                                                            </td>

                                                            {/* ── Birim Maliyet (editable) ── */}
                                                            <td className="px-3 py-1.5 text-right">
                                                                <InlineNumInput
                                                                    value={ev.maliyet}
                                                                    isSaving={isSaving}
                                                                    onCommit={val => handleCellCommit(row.id, 'maliyet', val)}
                                                                />
                                                            </td>

                                                            {/* ── Birim Satış Fiyatı (editable) ── */}
                                                            <td className="px-3 py-1.5 text-right">
                                                                <InlineNumInput
                                                                    value={ev.fiyat}
                                                                    isSaving={isSaving}
                                                                    onCommit={val => handleCellCommit(row.id, 'fiyat', val)}
                                                                />
                                                            </td>

                                                            {/* ── Toplam Maliyet (read-only, derived) ── */}
                                                            <td className="px-4 py-2.5 text-right text-sm text-slate-600 dark:text-slate-300">
                                                                {fmt(row.toplamMaliyet)}
                                                            </td>

                                                            {/* ── Toplam Ciro (read-only, derived) ── */}
                                                            <td className="px-4 py-2.5 text-right text-sm text-slate-600 dark:text-slate-300">
                                                                {fmt(row.toplamCiro)}
                                                            </td>

                                                            {/* ── Ürün Bazlı Kâr (read-only, derived) ── */}
                                                            <td className="px-4 py-2.5 text-right">
                                                                <span className={`inline-block rounded-lg px-3 py-1 text-sm font-bold transition-colors ${
                                                                    karPositive
                                                                        ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                        : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                                }`}>
                                                                    {karPositive ? '+' : ''}{fmt(row.kar)}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })
                                            )}
                                        </tbody>

                                        {/* Totals footer */}
                                        {filteredAndSorted.length > 0 && (
                                            <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                                                <tr>
                                                    <td colSpan={4} className="px-4 py-3 text-sm font-bold text-slate-700 dark:text-slate-200">
                                                        Toplam ({filteredAndSorted.length} ürün)
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-700 dark:text-slate-200">
                                                        {fmt(filteredAndSorted.reduce((s, r) => s + r.toplamMaliyet, 0))}
                                                    </td>
                                                    <td className="px-4 py-3 text-right text-sm font-bold text-slate-700 dark:text-slate-200">
                                                        {fmt(filteredAndSorted.reduce((s, r) => s + r.toplamCiro, 0))}
                                                    </td>
                                                    <td className="px-4 py-3 text-right">
                                                        {(() => {
                                                            const total = filteredAndSorted.reduce((s, r) => s + r.kar, 0);
                                                            return (
                                                                <span className={`inline-block rounded-lg px-3 py-1 text-sm font-extrabold ${
                                                                    total >= 0
                                                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                                        : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                                                                }`}>
                                                                    {total >= 0 ? '+' : ''}{fmt(total)}
                                                                </span>
                                                            );
                                                        })()}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        )}
                                    </table>
                                </div>
                            </div>

                            <p className="mt-4 text-xs text-slate-400 dark:text-slate-600">
                                * Hücreye tıklayın, değeri girin ve <strong>Enter</strong> veya tablonun dışına tıklayarak kaydedin.
                                &nbsp;Hesaplanan sütunlar (Toplam Maliyet, Ciro, Kâr) anlık olarak güncellenir.
                            </p>
                        </>
                    )}

                    {/* ══════════ TAB: KASA VE GİDERLER ══════════ */}
                    {activeTab === 'kasa' && (
                        <div className="space-y-6">
                            {/* Gider Ekle Formu */}
                            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <h2 className="mb-4 text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 dark:bg-rose-900/30">
                                        <svg className="h-4 w-4 text-rose-600 dark:text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" />
                                        </svg>
                                    </span>
                                    Yeni Gider Ekle
                                </h2>
                                <form onSubmit={handleAddGider} className="grid gap-4 sm:grid-cols-3">
                                    <div>
                                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Gider Türü</label>
                                        <select
                                            value={giderTuru}
                                            onChange={e => setGiderTuru(e.target.value as GiderTuru)}
                                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                        >
                                            {GIDER_TURLERI.map(t => (
                                                <option key={t} value={t}>{t}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Tutar (₺)</label>
                                        <input
                                            type="number"
                                            required
                                            min="0.01"
                                            step="0.01"
                                            placeholder="0.00"
                                            value={giderTutar}
                                            onChange={e => setGiderTutar(e.target.value)}
                                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Açıklama</label>
                                        <input
                                            type="text"
                                            placeholder="Opsiyonel not..."
                                            value={giderAciklama}
                                            onChange={e => setGiderAciklama(e.target.value)}
                                            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                        />
                                    </div>
                                    <div className="sm:col-span-3 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={savingGider}
                                            className="rounded-xl bg-rose-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 transition-colors disabled:opacity-60 flex items-center gap-2"
                                        >
                                            {savingGider ? (
                                                <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />Kaydediliyor...</>
                                            ) : (
                                                <><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>Gider Kaydet</>
                                            )}
                                        </button>
                                    </div>
                                </form>
                            </div>

                            {/* Gider Tablosu */}
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                                    <h2 className="font-bold text-slate-800 dark:text-white">Gider Kayıtları</h2>
                                    <span className="rounded-full bg-rose-100 px-3 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                                        Toplam: {fmt(toplamKasaGideri)}
                                    </span>
                                </div>

                                {loadingGiderler ? (
                                    <div className="flex h-32 items-center justify-center">
                                        <div className="h-8 w-8 animate-spin rounded-full border-4 border-rose-500 border-t-transparent" />
                                    </div>
                                ) : giderler.length === 0 ? (
                                    <div className="py-16 text-center text-slate-400 dark:text-slate-500">
                                        <svg className="mx-auto mb-3 h-10 w-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                        <p className="text-sm">Henüz gider kaydı yok.</p>
                                    </div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800">
                                            <thead className="bg-slate-50 dark:bg-slate-800">
                                                <tr>
                                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tarih</th>
                                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Gider Türü</th>
                                                    <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Açıklama</th>
                                                    <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">Tutar</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                                {giderler.map((g, i) => (
                                                    <tr key={g.id} className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${i % 2 === 0 ? '' : 'bg-slate-50/50 dark:bg-slate-800/20'}`}>
                                                        <td className="px-6 py-3 text-sm text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                            {g.tarih.toDate().toLocaleString('tr-TR')}
                                                        </td>
                                                        <td className="px-6 py-3">
                                                            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${GIDER_COLORS[g.giderTuru]}`}>
                                                                {g.giderTuru}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-3 text-sm text-slate-600 dark:text-slate-300">
                                                            {g.aciklama || <span className="text-slate-300 dark:text-slate-600 italic">—</span>}
                                                        </td>
                                                        <td className="px-6 py-3 text-right">
                                                            <span className="text-sm font-bold text-rose-600 dark:text-rose-400">
                                                                -{fmt(g.tutar)}
                                                            </span>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                            <tfoot className="border-t-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-800">
                                                <tr>
                                                    <td colSpan={3} className="px-6 py-3 text-sm font-bold text-slate-700 dark:text-slate-200">Toplam ({giderler.length} kayıt)</td>
                                                    <td className="px-6 py-3 text-right">
                                                        <span className="inline-block rounded-lg bg-rose-100 px-3 py-1 text-sm font-extrabold text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">
                                                            -{fmt(toplamKasaGideri)}
                                                        </span>
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* ══════════ TAB: GERÇEKLEŞen KÂR/ZARAR ══════════ */}
                    {activeTab === 'pnl' && (
                        <div className="space-y-6">
                            {/* Refresh button */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white">Gerçekleşen Kâr / Zarar Analizi</h2>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                                        Satış gelirleri − Satılan Malın Maliyeti (SMM) − İşletme Giderleri
                                    </p>
                                </div>
                                <button
                                    onClick={refreshPnl}
                                    disabled={loadingPnl}
                                    className="flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50 dark:border-violet-800 dark:bg-violet-900/20 dark:text-violet-400"
                                >
                                    <svg className={`h-4 w-4 ${loadingPnl ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    {loadingPnl ? 'Hesaplanıyor...' : 'Yenile'}
                                </button>
                            </div>

                            {/* ── P&L Dashboard Cards ── */}
                            {loadingPnl ? (
                                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                                    {[...Array(4)].map((_, i) => <PnlSkeletonCard key={i} />)}
                                </div>
                            ) : pnlData ? (
                                <>
                                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
                                        {/* A: Revenue */}
                                        <MetricCard
                                            title="Toplam Gerçekleşen Ciro"
                                            value={fmt(pnlData.toplamGelir)}
                                            subtitle={`${pnlData.transactionCount} satış + kart ücretleri`}
                                            gradient="bg-gradient-to-br from-blue-500 to-indigo-700"
                                            icon={
                                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                </svg>
                                            }
                                        />
                                        {/* B: COGS */}
                                        <MetricCard
                                            title="Satılan Malın Maliyeti (SMM)"
                                            value={fmt(pnlData.toplamCOGS)}
                                            subtitle={`${pnlData.snapshotCount}/${pnlData.transactionCount} işlem için kesin maliyet snapshot’ı`}
                                            gradient="bg-gradient-to-br from-amber-500 to-orange-700"
                                            icon={
                                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                                                </svg>
                                            }
                                        />
                                        {/* C: OPEX */}
                                        <MetricCard
                                            title="Toplam İşletme Gideri"
                                            value={fmt(pnlData.toplamOPEX)}
                                            subtitle="Benzin, kasa teslimi ve diğer giderler"
                                            gradient="bg-gradient-to-br from-rose-600 to-red-800"
                                            icon={
                                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                                </svg>
                                            }
                                        />
                                        {/* D: Net Profit — distinct deep purple / gold */}
                                        <MetricCard
                                            title="NET GERÇEKLEŞEN KÂR"
                                            value={fmt(pnlData.netKar)}
                                            subtitle="Ciro − SMM − İşletme Giderleri"
                                            gradient={
                                                pnlData.netKar >= 0
                                                    ? 'bg-gradient-to-br from-violet-600 via-purple-700 to-fuchsia-800'
                                                    : 'bg-gradient-to-br from-red-600 to-rose-800'
                                            }
                                            icon={
                                                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                                                </svg>
                                            }
                                        />
                                    </div>

                                    {/* ── Legacy Coverage Banner ── */}
                                    {pnlData.legacyCount > 0 && (
                                        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
                                            <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                            </svg>
                                            <div className="text-xs text-amber-800 dark:text-amber-300">
                                                <strong>{pnlData.legacyCount} eski işlem</strong> bu sistem güncellemesinden önce kaydedildiği için SMM verisi bulunmuyor (SMM = ₺0 sayıldı).
                                                &nbsp;<strong>{pnlData.snapshotCount} yeni işlem</strong> için anlık maliyet kaydı mevcuttur — bu işlemler %100 doğru SMM ile raporlanıyor.
                                            </div>
                                        </div>
                                    )}

                                    {/* ── P&L Breakdown Summary Table ── */}
                                    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                                            <h3 className="font-bold text-slate-800 dark:text-white">Gelir-Gider Özeti</h3>
                                            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-bold ${
                                                pnlData.netKar >= 0
                                                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400'
                                                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                            }`}>
                                                Net: {pnlData.netKar >= 0 ? '+' : ''}{fmt(pnlData.netKar)}
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800">
                                                <thead className="bg-slate-50 dark:bg-slate-800">
                                                    <tr>
                                                        <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Kalem</th>
                                                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tutar</th>
                                                        <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Oranı</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                                    {/* Revenue rows */}
                                                    <tr className="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                                                        <td className="px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
                                                                Satış Geliri (Öğrenci ve Personel)
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                            +{fmt(pnlData.toplamGelir - pnlData.kartUcretiToplamı)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">
                                                            {pnlData.toplamGelir > 0 ? ((( pnlData.toplamGelir - pnlData.kartUcretiToplamı) / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                        </td>
                                                    </tr>
                                                    <tr className="hover:bg-blue-50/30 dark:hover:bg-blue-900/10 transition-colors">
                                                        <td className="px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-indigo-400" />
                                                                Kart Ücretleri Geliri
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                                                            +{fmt(pnlData.kartUcretiToplamı)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">
                                                            {pnlData.toplamGelir > 0 ? ((pnlData.kartUcretiToplamı / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                        </td>
                                                    </tr>
                                                    {/* Total Revenue */}
                                                    <tr className="bg-blue-50/50 dark:bg-blue-900/10">
                                                        <td className="px-6 py-3 text-sm font-bold text-slate-800 dark:text-slate-100 pl-8">
                                                            Toplam Ciro (A)
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-bold text-blue-700 dark:text-blue-300">
                                                            +{fmt(pnlData.toplamGelir)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">100%</td>
                                                    </tr>
                                                    {/* COGS */}
                                                    <tr className="hover:bg-amber-50/30 dark:hover:bg-amber-900/10 transition-colors">
                                                        <td className="px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />
                                                                Satılan Malın Maliyeti — SMM (B)
                                                                <span className="text-xs text-slate-400 italic">tahmin</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-semibold text-amber-700 dark:text-amber-400">
                                                            -{fmt(pnlData.toplamCOGS)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">
                                                            {pnlData.toplamGelir > 0 ? ((pnlData.toplamCOGS / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                        </td>
                                                    </tr>
                                                    {/* Gross Profit */}
                                                    <tr className="bg-amber-50/50 dark:bg-amber-900/10">
                                                        <td className="px-6 py-3 text-sm font-bold text-slate-800 dark:text-slate-100 pl-8">
                                                            Brüt Kâr (A − B)
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-bold text-amber-700 dark:text-amber-300">
                                                            {fmt(pnlData.toplamGelir - pnlData.toplamCOGS)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">
                                                            {pnlData.toplamGelir > 0 ? (((pnlData.toplamGelir - pnlData.toplamCOGS) / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                        </td>
                                                    </tr>
                                                    {/* OPEX */}
                                                    <tr className="hover:bg-rose-50/30 dark:hover:bg-rose-900/10 transition-colors">
                                                        <td className="px-6 py-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                                                            <div className="flex items-center gap-2">
                                                                <span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />
                                                                Toplam İşletme Gideri — OPEX (C)
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-sm font-semibold text-rose-700 dark:text-rose-400">
                                                            -{fmt(pnlData.toplamOPEX)}
                                                        </td>
                                                        <td className="px-6 py-3 text-right text-xs text-slate-400">
                                                            {pnlData.toplamGelir > 0 ? ((pnlData.toplamOPEX / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                        </td>
                                                    </tr>
                                                    {/* Net Profit — highlighted */}
                                                    <tr className={`border-t-2 ${
                                                        pnlData.netKar >= 0
                                                            ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-900/20'
                                                            : 'border-red-300 bg-red-50 dark:border-red-700 dark:bg-red-900/20'
                                                    }`}>
                                                        <td className="px-6 py-4 text-base font-extrabold text-slate-800 dark:text-white">
                                                            🏆 NET GERÇEKLEŞEN KÂR (A − B − C)
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <span className={`text-lg font-extrabold ${
                                                                pnlData.netKar >= 0
                                                                    ? 'text-violet-700 dark:text-violet-300'
                                                                    : 'text-red-700 dark:text-red-300'
                                                            }`}>
                                                                {pnlData.netKar >= 0 ? '+' : ''}{fmt(pnlData.netKar)}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-right">
                                                            <span className={`text-sm font-bold ${
                                                                pnlData.netKar >= 0 ? 'text-violet-500' : 'text-red-500'
                                                            }`}>
                                                                {pnlData.toplamGelir > 0 ? ((pnlData.netKar / pnlData.toplamGelir) * 100).toFixed(1) : '0.0'}%
                                                            </span>
                                                        </td>
                                                    </tr>
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* ── Recent Transactions Detail Table ── */}
                                    {pnlData.satirlar.length > 0 && (
                                        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
                                                <h3 className="font-bold text-slate-800 dark:text-white">Son 50 Satış İşlemi</h3>
                                                <span className="rounded-full bg-slate-100 px-3 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                                    {pnlData.satirlar.length} kayıt
                                                </span>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800">
                                                    <thead className="bg-slate-50 dark:bg-slate-800">
                                                        <tr>
                                                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Tarih</th>
                                                            <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Açıklama</th>
                                                            <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Gelir</th>
                                                            <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">SMM</th>
                                                            <th className="px-6 py-3 text-center text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Maliyet Kaydı</th>
                                                            <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Brüt Kâr</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-50 dark:divide-slate-800">
                                                        {pnlData.satirlar.map((tx, i) => (
                                                            <tr key={i} className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50 ${i % 2 === 0 ? '' : 'bg-slate-50/40 dark:bg-slate-800/20'}`}>
                                                                <td className="px-6 py-2.5 text-xs text-slate-400 whitespace-nowrap">
                                                                    {tx.tarih.toDate().toLocaleString('tr-TR')}
                                                                </td>
                                                                <td className="px-5 py-2.5 text-sm text-slate-700 dark:text-slate-300 max-w-xs">
                                                                    {tx.aciklama}
                                                                </td>
                                                                <td className="px-6 py-2.5 text-right text-sm font-semibold text-blue-600 dark:text-blue-400">
                                                                    +{fmt(tx.gelir)}
                                                                </td>
                                                                <td className="px-6 py-2.5 text-right text-sm text-amber-600 dark:text-amber-400">
                                                                    {tx.hasSnapshot ? `-${fmt(tx.maliyet)}` : <span className="text-slate-300 dark:text-slate-600">—</span>}
                                                                </td>
                                                                <td className="px-6 py-2.5 text-center">
                                                                    {tx.hasSnapshot ? (
                                                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                                                                            ✅ Kesin
                                                                        </span>
                                                                    ) : (
                                                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                                                            ⚠️ Eski Kayıt
                                                                        </span>
                                                                    )}
                                                                </td>
                                                                <td className="px-6 py-2.5 text-right">
                                                                    {tx.hasSnapshot ? (
                                                                        <span className={`text-sm font-bold ${
                                                                            tx.brütKar >= 0
                                                                                ? 'text-violet-600 dark:text-violet-400'
                                                                                : 'text-red-600 dark:text-red-400'
                                                                        }`}>
                                                                            {tx.brütKar >= 0 ? '+' : ''}{fmt(tx.brütKar)}
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-slate-300 dark:text-slate-600 text-sm">—</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}

                                    {/* Accounting notes */}
                        <p className="text-xs text-slate-400 dark:text-slate-600">
                                        * <strong>Yüklemeler (Bakiye Yükleme)</strong> gelir olarak kabul edilmez — bu kayıtlar öğrenci bakiyesi yükümlülüğüdür, hasılat değildir.
                                        &nbsp;SMM, her alışveriş anında uygulama tarafından anlık olarak hesaplanır ve işlem kaydına
                                        kalıcı olarak yazılır (fiyat değişikliklerinden etkilenmez).
                                    </p>
                                </>
                            ) : (
                                <div className="flex h-40 items-center justify-center rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
                                    <p className="text-sm text-slate-400">Veri yüklenemedi. Yenile butonunu deneyin.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ══════════ TAB: STOK DEFTERİ ══════════ */}
                    {activeTab === 'defteri' && (
                        <div className="space-y-4">
                            {/* Header row */}
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <h2 className="text-lg font-bold text-slate-800 dark:text-white flex items-center gap-2">
                                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                                            <svg className="h-4 w-4 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                        </span>
                                        Stok Defteri
                                    </h2>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Her manuel stok değişikliği otomatik olarak kaydedilir — gerçek zamanlı</p>
                                </div>
                                {/* Search */}
                                <div className="relative max-w-xs w-full">
                                    <svg className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
                                    </svg>
                                    <input
                                        type="text"
                                        placeholder="Ürün adına göre filtrele..."
                                        value={ledgerSearch}
                                        onChange={e => setLedgerSearch(e.target.value)}
                                        className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-9 pr-4 text-sm text-slate-800 shadow-sm outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-400/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-teal-500"
                                    />
                                </div>
                            </div>

                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                {loadingLedger ? (
                                    <div className="flex h-48 items-center justify-center">
                                        <div className="h-10 w-10 animate-spin rounded-full border-4 border-teal-500 border-t-transparent" />
                                    </div>
                                ) : (() => {
                                    const lower = ledgerSearch.toLowerCase();
                                    const filtered = stokHareketleri.filter(h =>
                                        h.urunAdi.toLowerCase().includes(lower)
                                    );
                                    return filtered.length === 0 ? (
                                        <div className="py-20 text-center text-slate-400 dark:text-slate-500">
                                            <svg className="mx-auto mb-3 h-12 w-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                            <p className="text-sm">
                                                {ledgerSearch ? 'Bu aramayla eşleşen hareket bulunamadı.' : 'Henüz stok hareketi kaydedilmemiş.'}
                                            </p>
                                            <p className="text-xs mt-1">Stok & Ürün Analizi sekmesinden bir ürünün stok adetini düzenleyin.</p>
                                        </div>
                                    ) : (
                                        <div className="overflow-x-auto">
                                            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                                                <thead className="bg-slate-50 dark:bg-slate-800">
                                                    <tr>
                                                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">Tarih</th>
                                                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Ürün Adı</th>
                                                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">İşlem</th>
                                                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">Eski Stok</th>
                                                        <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">Yeni Stok</th>
                                                        <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">İşlem Yapan</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                    {filtered.map((h, idx) => {
                                                        const isGiris = h.miktarDegisimi > 0;
                                                        const tarih = h.tarih instanceof Timestamp
                                                            ? h.tarih.toDate()
                                                            : new Date((h.tarih as any)?.seconds * 1000 || Date.now());
                                                        return (
                                                            <tr
                                                                key={h.id}
                                                                className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${idx % 2 === 0 ? '' : 'bg-slate-50/40 dark:bg-slate-800/20'}`}
                                                            >
                                                                {/* Tarih */}
                                                                <td className="px-5 py-3 text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
                                                                    <div>{tarih.toLocaleDateString('tr-TR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                                                                    <div className="text-slate-400">{tarih.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
                                                                </td>
                                                                {/* Ürün Adı */}
                                                                <td className="px-5 py-3">
                                                                    <span className="font-medium text-slate-800 dark:text-slate-100 text-sm">{h.urunAdi}</span>
                                                                </td>
                                                                {/* İşlem badge */}
                                                                <td className="px-5 py-3">
                                                                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                                                                        isGiris
                                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                                    }`}>
                                                                        <span className="text-base leading-none">{isGiris ? '▲' : '▼'}</span>
                                                                        {isGiris ? `+${h.miktarDegisimi}` : h.miktarDegisimi} Adet
                                                                        &nbsp;·&nbsp;
                                                                        {h.islemTipi}
                                                                    </span>
                                                                </td>
                                                                {/* Eski Stok */}
                                                                <td className="px-5 py-3 text-right text-sm text-slate-500 dark:text-slate-400">
                                                                    {h.eskiStok}
                                                                </td>
                                                                {/* Yeni Stok */}
                                                                <td className="px-5 py-3 text-right">
                                                                    <span className={`inline-block rounded-lg px-2.5 py-0.5 text-sm font-bold ${
                                                                        h.yeniStok === 0
                                                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                                                            : h.yeniStok <= 15
                                                                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                                                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                                                    }`}>
                                                                        {h.yeniStok}
                                                                    </span>
                                                                </td>
                                                                {/* İşlem Yapan */}
                                                                <td className="px-5 py-3">
                                                                    <div className="flex items-center gap-2">
                                                                        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300">
                                                                            {h.islemYapan?.charAt(0)?.toUpperCase() ?? 'S'}
                                                                        </div>
                                                                        <span className="text-sm text-slate-600 dark:text-slate-300">{h.islemYapan ?? 'Sistem Yoneticisi'}</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                            <div className="border-t border-slate-100 px-5 py-3 dark:border-slate-800">
                                                <p className="text-xs text-slate-400 dark:text-slate-500">{filtered.length} hareket gösteriliyor · En yeni üstte</p>
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>
                        </div>
                    )}

                    {activeTab === 'mutabakat' && (
                        <div className="space-y-4">
                            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
                                <h2 className="font-bold text-amber-900 dark:text-amber-200">Offline satış mutabakatı</h2>
                                <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
                                    Bu liste, ürün teslim edildikten sonra sunucu stok veya bakiye çakışması nedeniyle otomatik işlenemeyen satışları gösterir. Kayıtlar silinmez.
                                </p>
                            </div>
                            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                                {loadingMutabakat ? (
                                    <div className="flex h-40 items-center justify-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-amber-500 border-t-transparent" /></div>
                                ) : mutabakatlar.length === 0 ? (
                                    <div className="py-16 text-center text-sm text-slate-400">Mutabakat bekleyen offline satış yok.</div>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                                            <thead className="bg-slate-50 dark:bg-slate-800"><tr>
                                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Satış / Tarih</th>
                                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Hesap</th>
                                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Ürünler</th>
                                                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Tutar</th>
                                                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Sunucu sonucu</th>
                                            </tr></thead>
                                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                                {mutabakatlar.map(m => (
                                                    <tr key={m.id}>
                                                        <td className="px-5 py-3 text-xs text-slate-500"><div className="font-mono">{m.satisId}</div><div>{m.yerelTarih ? new Date(m.yerelTarih).toLocaleString('tr-TR') : '-'}</div></td>
                                                        <td className="px-5 py-3 text-sm text-slate-700 dark:text-slate-200"><div className="font-medium">{m.ogrenciAdi ?? '-'}</div><div className="text-xs text-slate-400">{m.kartID ?? '-'}</div></td>
                                                        <td className="px-5 py-3 text-sm text-slate-600 dark:text-slate-300">{m.urunler?.map(u => `${u.ad} (x${u.miktar})`).join(', ') || '-'}</td>
                                                        <td className="px-5 py-3 text-right font-bold text-slate-800 dark:text-white">{fmt(Number(m.toplamTutar ?? 0))}</td>
                                                        <td className="px-5 py-3 text-sm text-red-600 dark:text-red-400">{m.hata ?? 'Mutabakat gerekli'}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>

            )}
        </div>
    );
}
