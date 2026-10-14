import { isHarcama, type Islem, type Ogrenci } from '@/types';

export type HarcamaDonemi = 'gunluk' | 'haftalik' | 'aylik';

export interface HarcamaSatiri {
    anahtar: string;
    ogrenciId: string;
    ogrenciAdi: string;
    sinif: string;
    tarih: Date;
    tarihAnahtari: string;
    urunler: string;
    tutar: number;
    satisId?: string;
}

const tarihParcalari = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

export function istanbulTarihAnahtari(tarih: Date): string {
    const parcalar = Object.fromEntries(tarihParcalari.formatToParts(tarih).map(parca => [parca.type, parca.value]));
    return `${parcalar.year}-${parcalar.month}-${parcalar.day}`;
}

function islemTarihi(deger: Islem['tarih']): Date | null {
    const kaynak = deger as unknown;
    let tarih: Date;
    if (kaynak && typeof kaynak === 'object' && 'toDate' in kaynak && typeof kaynak.toDate === 'function') {
        tarih = kaynak.toDate() as Date;
    } else if (kaynak && typeof kaynak === 'object' && 'seconds' in kaynak && typeof kaynak.seconds === 'number') {
        tarih = new Date(kaynak.seconds * 1000);
    } else {
        tarih = new Date(kaynak as string);
    }
    return Number.isNaN(tarih.getTime()) ? null : tarih;
}

function urunOzeti(islem: Islem): string {
    if (Array.isArray(islem.urunler) && islem.urunler.length > 0) {
        const adlar = islem.urunler.map(urun => {
            if (typeof urun === 'string') return urun.trim();
            if (!urun || typeof urun.ad !== 'string') return '';
            const ad = urun.ad.trim();
            return ad && urun.miktar > 1 ? `${ad} × ${urun.miktar}` : ad;
        }).filter(Boolean);
        if (adlar.length > 0) return adlar.join(', ');
    }

    const aciklama = typeof islem.aciklama === 'string' ? islem.aciklama.trim() : '';
    return aciklama && !/^kantin alışverişi$/i.test(aciklama)
        ? aciklama
        : 'Ürün bilgisi kaydedilmemiş';
}

export function harcamaSatirlariOlustur(ogrenciler: Ogrenci[]): HarcamaSatiri[] {
    const satirlar: HarcamaSatiri[] = [];
    for (const ogrenci of ogrenciler) {
        if (ogrenci.tip === 'Personel') continue;
        for (const [sira, islem] of (ogrenci.islemGecmisi || []).entries()) {
            if (islem.isCancelled || !isHarcama(islem.tip, islem.tutar) ||
                typeof islem.tutar !== 'number' || !Number.isFinite(islem.tutar)) continue;
            const tarih = islemTarihi(islem.tarih);
            if (!tarih) continue;
            satirlar.push({
                anahtar: `${ogrenci.id}-${sira}`,
                ogrenciId: ogrenci.id,
                ogrenciAdi: ogrenci.adSoyad || 'İsimsiz öğrenci',
                sinif: ogrenci.sinif || '',
                tarih,
                tarihAnahtari: istanbulTarihAnahtari(tarih),
                urunler: urunOzeti(islem),
                tutar: Math.abs(islem.tutar),
                satisId: islem.satisId,
            });
        }
    }
    return satirlar.sort((a, b) => b.tarih.getTime() - a.tarih.getTime() || a.anahtar.localeCompare(b.anahtar));
}

function tarihKaydir(tarihAnahtari: string, gun: number): string {
    const [yil, ay, gunNo] = tarihAnahtari.split('-').map(Number);
    return new Date(Date.UTC(yil, ay - 1, gunNo + gun)).toISOString().slice(0, 10);
}

export function donemAraligi(donem: HarcamaDonemi, seciliTarih: string): { baslangic: string; bitis: string } {
    const [yil, ay, gun] = seciliTarih.split('-').map(Number);
    if (donem === 'gunluk') return { baslangic: seciliTarih, bitis: seciliTarih };
    if (donem === 'aylik') {
        return {
            baslangic: `${yil}-${String(ay).padStart(2, '0')}-01`,
            bitis: new Date(Date.UTC(yil, ay, 0)).toISOString().slice(0, 10),
        };
    }
    const haftaninGunu = new Date(Date.UTC(yil, ay - 1, gun)).getUTCDay();
    const baslangic = tarihKaydir(seciliTarih, -((haftaninGunu + 6) % 7));
    return { baslangic, bitis: tarihKaydir(baslangic, 6) };
}

export function donemKaydir(donem: HarcamaDonemi, seciliTarih: string, yon: -1 | 1): string {
    if (donem === 'gunluk') return tarihKaydir(seciliTarih, yon);
    if (donem === 'haftalik') return tarihKaydir(seciliTarih, yon * 7);
    const [yil, ay] = seciliTarih.split('-').map(Number);
    return new Date(Date.UTC(yil, ay - 1 + yon, 1)).toISOString().slice(0, 10);
}
