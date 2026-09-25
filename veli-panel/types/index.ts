// TypeScript type definitions for Veli Panel

import { Timestamp } from 'firebase/firestore';

export interface Veli {
    veliID: string;
    authID?: string; // Links to Firebase Auth UID
    adSoyad: string;
    telefonNo: string;
    email?: string;
    kayitTarihi: Timestamp;
    aktif: boolean;
    sifreDegistirmeZorunlu?: boolean; // New: Forced password change
    role?: 'admin' | 'veli'; // Yöneticileri belirlemek için rol eklendi
    unvan?: string; // Örn: 'Müdür', 'Müdür Yardımcısı'
}

export interface CocukTalebi {
    talepID: string;
    veliID: string;
    veliAdi: string;
    cocukAdi: string;
    sinif?: string;
    kartID?: string | null;
    durum: 'beklemede' | 'onaylandi' | 'reddedildi';
    olusturmaTarihi: Timestamp;
    onaylamaTarihi?: Timestamp;
    notlar?: string;
}

export interface KartUcreti {
    tarih: Timestamp;
    tutar: number;      // Bu kartta alınan ücret (örn: 50)
    islemNo: number;    // Kaçıncı kart (1, 2, 3...)
    aciklama: string;   // "1. Kart: 50.00 ₺"
    isCancelled?: boolean; // İptal edildi mi?
}

export interface Ogrenci {
    id: string; // Firestore Document ID
    kartID: string; // Physical Card Number (now optional/empty)
    adSoyad: string;
    sinif: string;
    bakiye: number;
    islemGecmisi: Islem[];
    veliIDleri?: string[]; // IDs of up to 2 parents
    veliTelefonlari?: string[]; // Phone numbers for easier lookup
    resimURL?: string; // Student photo URL in Firebase Storage
    toplamKartUcreti?: number;        // Kümülatif toplam kart ücreti
    kartUcretiGecmisi?: KartUcreti[]; // Kart ücreti geçmişi
    tip?: 'Öğrenci' | 'Personel'; // Ayrım için
    unvan?: string; // Personele özel unvan (Örn: Müdür, Öğretmen)
}

/**
 * Structured product line-item — written by the POS tablet for every checkout.
 * Replaces the legacy string format (e.g. "Eti Canga (x2)").
 */
export interface UrunKalemi {
    id: string;           // Firestore document ID of the product
    ad: string;           // Product name snapshot at time of purchase
    miktar: number;       // Quantity purchased
    birimFiyat: number;   // Unit selling price at time of purchase
    toplamTutar: number;  // miktar × birimFiyat
}

export interface Islem {
    satisId?: string;
    tarih: Timestamp;
    tip: 'Bakiye Yükleme' | 'Ödeme' | 'Harcama';
    tutar: number;
    aciklama: string;
    toplamMaliyet?: number;  // ✅ Immutable COGS snapshot — written at checkout. Absent on legacy records.
    /**
     * New format (post 2026-06): Array of UrunKalemi objects with full price breakdown.
     * Legacy format (pre 2026-06): Array of strings like "Eti Canga (x2)".
     * Always check with: Array.isArray(urunler) && typeof urunler[0] === 'object'
     */
    urunler?: (UrunKalemi | string)[];
    islemFotografi?: string;
    isCancelled?: boolean;
}

/** Flutter 'Harcama', Web 'Ödeme' — ikisini de harcama olarak kabul et. Ayrıca tutar negatifse de harcamadır. */
export function isHarcama(tip: string, tutar?: number): boolean {
    return tip === 'Ödeme' || tip === 'Harcama' || (tutar !== undefined && tutar < 0);
}

export interface CocukWithStatus extends CocukTalebi {
    ogrenciData?: Ogrenci;
}

export interface Urun {
    id: string; // Firestore Document ID
    ad: string;
    fiyat: number;
    maliyet?: number; // Birim maliyet (unit cost) — varsayılan: 0
    resimURL?: string;
    kategori?: string;
    stok: number;
    olusturmaTarihi: Timestamp;
}

// ─────────────────────────────────────────────────────────────────────
// Stock Ledger — every manual stock change is logged here
// ─────────────────────────────────────────────────────────────────────
export type StokIslemTipi =
    | 'Stok Ekleme / Giriş'
    | 'Stok Düzeltme / Çıkış'
    | 'Satış'
    | 'Satış İptali';

export interface StokHareketi {
    id: string;                 // Firestore Document ID
    urunId: string;             // ID of the affected product
    urunAdi: string;            // Product name snapshot
    miktarDegisimi: number;     // Signed difference: positive = inflow, negative = correction
    eskiStok: number;           // Stock value before the change
    yeniStok: number;           // Stock value after the change
    tarih: Timestamp;           // Server timestamp of the operation
    islemTipi: StokIslemTipi;   // 'Stok Ekleme / Giriş' | 'Stok Düzeltme / Çıkış'
    islemYapan: string;         // Admin display name — defaults to 'Sistem Yöneticisi'
    referansId?: string;
    posUid?: string;
}
