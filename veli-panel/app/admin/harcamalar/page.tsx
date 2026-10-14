'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Ogrenci } from '@/types';
import {
    donemAraligi,
    donemKaydir,
    harcamaSatirlariOlustur,
    istanbulTarihAnahtari,
    type HarcamaDonemi,
} from '@/lib/harcamalar';

const donemler: { id: HarcamaDonemi; ad: string }[] = [
    { id: 'gunluk', ad: 'Günlük' },
    { id: 'haftalik', ad: 'Haftalık' },
    { id: 'aylik', ad: 'Aylık' },
];

const paraBicimi = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' });
const saatBicimi = new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit',
});

function tarihGoster(anahtar: string): string {
    const [yil, ay, gun] = anahtar.split('-');
    return `${gun}.${ay}.${yil}`;
}

export default function HarcamalarPage() {
    const [ogrenciler, setOgrenciler] = useState<Ogrenci[]>([]);
    const [donem, setDonem] = useState<HarcamaDonemi>('gunluk');
    const [seciliTarih, setSeciliTarih] = useState(() => istanbulTarihAnahtari(new Date()));
    const [yukleniyor, setYukleniyor] = useState(true);
    const [hata, setHata] = useState('');
    const [aktarimHatasi, setAktarimHatasi] = useState('');
    const [aktariliyor, setAktariliyor] = useState(false);

    useEffect(() => {
        return onSnapshot(collection(db, 'ogrenciler'), snapshot => {
            setOgrenciler(snapshot.docs.map(kayit => ({ ...kayit.data(), id: kayit.id } as Ogrenci)));
            setHata('');
            setYukleniyor(false);
        }, error => {
            setHata(error.code === 'permission-denied'
                ? 'Harcamaları görmek için yönetici hesabıyla giriş yapın.'
                : 'Harcama kayıtları yüklenemedi. Bağlantınızı kontrol edip sayfayı yenileyin.');
            setYukleniyor(false);
        });
    }, []);

    const tumSatirlar = useMemo(() => harcamaSatirlariOlustur(ogrenciler), [ogrenciler]);
    const aralik = useMemo(() => donemAraligi(donem, seciliTarih), [donem, seciliTarih]);
    const satirlar = useMemo(() => tumSatirlar.filter(satir =>
        satir.tarihAnahtari >= aralik.baslangic && satir.tarihAnahtari <= aralik.bitis,
    ), [tumSatirlar, aralik]);
    const toplam = useMemo(() => Math.round(satirlar.reduce((tutar, satir) => tutar + satir.tutar, 0) * 100) / 100, [satirlar]);
    const ogrenciSayisi = useMemo(() => new Set(satirlar.map(satir => satir.ogrenciId)).size, [satirlar]);

    async function excelIndir() {
        if (satirlar.length === 0 || aktariliyor) return;
        setAktarimHatasi('');
        setAktariliyor(true);
        try {
            const XLSX = await import('xlsx');
            const veri = satirlar.map(satir => ({
                'Tarih': tarihGoster(satir.tarihAnahtari),
                'Saat': saatBicimi.format(satir.tarih),
                'Öğrenci': satir.ogrenciAdi,
                'Sınıf': satir.sinif,
                'Alınan Ürünler': satir.urunler,
                'Tutar (TL)': satir.tutar,
                'Satış ID': satir.satisId || '',
            }));
            const sayfa = XLSX.utils.json_to_sheet(veri);
            XLSX.utils.sheet_add_aoa(sayfa, [['', '', '', '', 'Toplam', toplam]], { origin: `A${veri.length + 3}` });
            sayfa['!cols'] = [
                { wch: 14 }, { wch: 9 }, { wch: 27 }, { wch: 15 },
                { wch: 55 }, { wch: 17 }, { wch: 38 },
            ];
            const dosya = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(dosya, sayfa, 'Harcamalar');
            XLSX.writeFile(dosya, `Harcamalar_${donem}_${aralik.baslangic}_${aralik.bitis}.xlsx`);
        } catch {
            setAktarimHatasi('Excel dosyası oluşturulamadı. Lütfen tekrar deneyin.');
        } finally {
            setAktariliyor(false);
        }
    }

    return (
        <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-slate-900">Harcamalar</h1>
                    <p className="mt-2 text-slate-500">Öğrencilerin alışverişleri ve aldıkları ürünler</p>
                </div>
                <div className="text-right">
                    <button type="button" onClick={excelIndir}
                        disabled={yukleniyor || !!hata || satirlar.length === 0 || aktariliyor}
                        className="rounded-xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">
                        {aktariliyor ? 'Hazırlanıyor…' : 'Excel’e Aktar'}
                    </button>
                    {aktarimHatasi && <p role="alert" className="mt-2 text-sm text-red-600">{aktarimHatasi}</p>}
                </div>
            </div>

            <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-label="Dönem seçimi">
                <div className="flex flex-wrap items-center justify-between gap-5">
                    <div className="flex rounded-xl bg-slate-100 p-1">
                        {donemler.map(secenek => (
                            <button key={secenek.id} type="button" onClick={() => setDonem(secenek.id)}
                                aria-pressed={donem === secenek.id}
                                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${donem === secenek.id
                                    ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}>
                                {secenek.ad}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <label htmlFor="harcama-tarih" className="text-sm font-medium text-slate-600">Tarih seç</label>
                        <input id="harcama-tarih" type="date" value={seciliTarih}
                            onChange={event => { if (event.target.value) setSeciliTarih(event.target.value); }}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800" />
                        <button type="button" aria-label="Önceki dönem" onClick={() => setSeciliTarih(donemKaydir(donem, seciliTarih, -1))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50">←</button>
                        <button type="button" aria-label="Sonraki dönem" onClick={() => setSeciliTarih(donemKaydir(donem, seciliTarih, 1))}
                            className="rounded-lg border border-slate-300 px-3 py-2 text-slate-700 hover:bg-slate-50">→</button>
                    </div>
                </div>
                <p className="mt-4 text-sm text-slate-500">
                    Gösterilen dönem: <span className="font-semibold text-slate-700">{tarihGoster(aralik.baslangic)}{aralik.baslangic !== aralik.bitis && ` – ${tarihGoster(aralik.bitis)}`}</span>
                </p>
            </section>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-sm text-slate-500">Toplam harcama</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{paraBicimi.format(toplam)}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-sm text-slate-500">Alışveriş sayısı</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{satirlar.length}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-sm text-slate-500">Alışveriş yapan öğrenci</p>
                    <p className="mt-2 text-2xl font-bold text-slate-900">{ogrenciSayisi}</p>
                </div>
            </div>

            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-label="Öğrenci harcamaları">
                <div className="border-b border-slate-200 px-6 py-5">
                    <h2 className="text-lg font-bold text-slate-900">Alışverişler</h2>
                    <p className="mt-1 text-sm text-slate-500">Her satır bir alışverişi gösterir. İptal edilen işlemler dahil değildir.</p>
                </div>
                {hata ? <p role="alert" className="px-6 py-10 text-center text-red-600">{hata}</p>
                    : yukleniyor ? <p className="px-6 py-10 text-center text-slate-500">Kayıtlar yükleniyor…</p>
                        : satirlar.length === 0 ? <p className="px-6 py-10 text-center text-slate-500">Bu dönemde öğrenci harcaması bulunamadı.</p>
                            : <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                                        <tr>
                                            <th scope="col" className="whitespace-nowrap px-6 py-4">Tarih / Saat</th>
                                            <th scope="col" className="px-6 py-4">Öğrenci</th>
                                            <th scope="col" className="px-6 py-4">Alınan Ürünler</th>
                                            <th scope="col" className="whitespace-nowrap px-6 py-4 text-right">Tutar</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {satirlar.map(satir => (
                                            <tr key={satir.anahtar} className="hover:bg-slate-50">
                                                <td className="whitespace-nowrap px-6 py-4 text-slate-700">
                                                    <div className="font-medium">{tarihGoster(satir.tarihAnahtari)}</div>
                                                    <div className="text-slate-500">{saatBicimi.format(satir.tarih)}</div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="font-semibold text-slate-900">{satir.ogrenciAdi}</div>
                                                    {satir.sinif && <div className="text-xs text-slate-500">{satir.sinif}</div>}
                                                </td>
                                                <td className="min-w-64 px-6 py-4 text-slate-700">{satir.urunler}</td>
                                                <td className="whitespace-nowrap px-6 py-4 text-right font-semibold text-slate-900">{paraBicimi.format(satir.tutar)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>}
            </section>
        </main>
    );
}
