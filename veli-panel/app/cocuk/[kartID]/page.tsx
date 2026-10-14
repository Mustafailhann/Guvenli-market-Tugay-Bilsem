// Child Detail Page

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/hooks/useAuth';
import { getCurrentVeli, getCocuklarWithData } from '@/lib/firestore';
import { Ogrenci, isHarcama } from '@/types';
import Card from '@/components/ui/Card';
import PhotoModal from '@/components/admin/PhotoModal';

export default function CocukDetayPage({ params }: { params: Promise<{ kartID: string }> }) {
    const router = useRouter();
    const { user, loading: authLoading } = useAuth();
    const [ogrenci, setOgrenci] = useState<Ogrenci | null>(null);
    const [loading, setLoading] = useState(true);
    const [kartID, setKartID] = useState<string | null>(null);
    const [filter, setFilter] = useState<'week' | 'month' | 'all'>('week');
    const [selectedPhoto, setSelectedPhoto] = useState<{ path: string; saleId?: string; timestamp: string } | null>(null);

    useEffect(() => {
        params.then(p => setKartID(p.kartID));
    }, [params]);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/giris');
        }
    }, [user, authLoading, router]);

    useEffect(() => {
        async function fetchData() {
            if (!kartID || authLoading) return;
            if (!user) {
                setLoading(false);
                return;
            }
            try {
                const veli = await getCurrentVeli(user);
                const cocuklar = veli ? await getCocuklarWithData(veli.veliID) : [];
                const kendiCocugu = cocuklar.find(c => c.durum === 'onaylandi' && c.kartID === kartID);
                setOgrenci(kendiCocugu?.ogrenciData || null);
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [kartID, user, authLoading]);

    if (authLoading || loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto mb-4"></div>
                    <p className="text-gray-600">Yükleniyor...</p>
                </div>
            </div>
        );
    }

    if (!user || !ogrenci) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <p className="text-gray-600 mb-4">Öğrenci bulunamadı</p>
                    <Link href="/dashboard" className="text-indigo-600 hover:underline">
                        ← Dashboard&apos;a dön
                    </Link>
                </div>
            </div>
        );
    }

    // Filter transactions
    const now = new Date();
    const filteredIslemler = ogrenci.islemGecmisi.filter(islem => {
        const islemDate = islem.tarih.toDate();
        if (filter === 'week') {
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return islemDate >= weekAgo;
        } else if (filter === 'month') {
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            return islemDate >= monthAgo;
        }
        return true;
    });

    const toplamHarcama = filteredIslemler
        .filter(i => isHarcama(i.tip, i.tutar))
        .reduce((sum, islem) => sum + Math.abs(islem.tutar), 0);

    return (
        <div className="min-h-screen bg-gray-50">
            {/* Header */}
            <div className="bg-white border-b border-gray-200">
                <div className="container-custom py-6">
                    <Link
                        href="/dashboard"
                        className="text-indigo-600 hover:text-indigo-700 flex items-center gap-2 mb-4"
                    >
                        ← Geri
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900">{ogrenci.adSoyad}</h1>
                    <p className="text-gray-600 mt-1">Sınıf: {ogrenci.sinif} • Kart ID: {ogrenci.kartID}</p>
                </div>
            </div>

            {/* Main Content */}
            <div className="container-custom py-8">
                {/* Stats */}
                <div className="grid md:grid-cols-2 gap-6 mb-8">
                    <Card>
                        <div className="text-sm text-gray-600 mb-1">Güncel Bakiye</div>
                        <div className="text-4xl font-bold text-green-600">{ogrenci.bakiye.toFixed(2)} TL</div>
                    </Card>
                    <Card>
                        <div className="text-sm text-gray-600 mb-1">Toplam Harcama ({filter === 'week' ? 'Son 7 Gün' : filter === 'month' ? 'Son 30 Gün' : 'Tümü'})</div>
                        <div className="text-4xl font-bold text-purple-600">{toplamHarcama.toFixed(2)} TL</div>
                    </Card>
                </div>

                {/* Transaction History */}
                <Card>
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-2xl font-semibold">Alışveriş Geçmişi</h2>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setFilter('week')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'week'
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                            >
                                Son 7 Gün
                            </button>
                            <button
                                onClick={() => setFilter('month')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'month'
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                            >
                                Son 30 Gün
                            </button>
                            <button
                                onClick={() => setFilter('all')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${filter === 'all'
                                        ? 'bg-indigo-600 text-white'
                                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                    }`}
                            >
                                Tümü
                            </button>
                        </div>
                    </div>

                    {filteredIslemler.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            Bu dönemde işlem bulunmuyor
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {filteredIslemler.map((islem, index) => (
                                <div
                                    key={index}
                                    className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors"
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <div className="font-medium text-gray-900">
                                                {isHarcama(islem.tip, islem.tutar) ? '🛒' : '💳'} {isHarcama(islem.tip, islem.tutar) ? 'Harcama' : 'Bakiye Yükleme'}
                                            </div>
                                            <div className="text-sm text-gray-600 mt-1">
                                                {new Date(islem.tarih.toDate()).toLocaleString('tr-TR')}
                                            </div>
                                        </div>
                                        <div className={`text-lg font-semibold ${isHarcama(islem.tip, islem.tutar) ? 'text-red-600' : 'text-green-600'
                                            }`}>
                                            {isHarcama(islem.tip, islem.tutar) ? '-' : '+'}{Math.abs(islem.tutar).toFixed(2)} TL
                                        </div>
                                    </div>
                                    <div className="text-sm text-gray-700">{islem.aciklama}</div>
                                    {islem.islemFotografi && (
                                        <button
                                            onClick={() => setSelectedPhoto({
                                                path: islem.islemFotografi!,
                                                saleId: islem.satisId,
                                                timestamp: islem.tarih.toDate().toLocaleString('tr-TR'),
                                            })}
                                            className="mt-2 text-sm text-indigo-600 hover:underline"
                                        >
                                            📷 İşlem fotoğrafını gör
                                        </button>
                                    )}
                                    {islem.urunler && islem.urunler.length > 0 && (
                                        <div className="mt-2 text-xs text-gray-600">
                                            Ürünler: {islem.urunler.join(', ')}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </Card>
            </div>
            <PhotoModal
                isOpen={!!selectedPhoto}
                onClose={() => setSelectedPhoto(null)}
                photoPath={selectedPhoto?.path || ''}
                saleId={selectedPhoto?.saleId}
                timestamp={selectedPhoto?.timestamp}
            />
        </div>
    );
}
