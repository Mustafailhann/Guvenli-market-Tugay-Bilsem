import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Load the pure report logic without booting Firebase or Next.js.
const filename = path.join(path.dirname(fileURLToPath(import.meta.url)), '../lib/harcamalar.ts');
const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const subject = new Module(filename);
subject.filename = filename;
subject.paths = Module._nodeModulePaths(path.dirname(filename));
subject.require = specifier => specifier === '@/types'
    ? { isHarcama: (tip, tutar) => tip === 'Ödeme' || tip === 'Harcama' || (tutar !== undefined && tutar < 0) }
    : Module.prototype.require.call(subject, specifier);
subject._compile(javascript, filename);
const { istanbulTarihAnahtari, donemAraligi, donemKaydir, harcamaSatirlariOlustur } = subject.exports;

test('İstanbul gün sınırı ve takvim haftası doğru hesaplanır', () => {
    assert.equal(istanbulTarihAnahtari(new Date('2026-10-14T20:59:00Z')), '2026-10-14');
    assert.equal(istanbulTarihAnahtari(new Date('2026-10-14T21:00:00Z')), '2026-10-15');
    assert.deepEqual(donemAraligi('haftalik', '2026-10-18'), {
        baslangic: '2026-10-12', bitis: '2026-10-18',
    });
    assert.deepEqual(donemAraligi('aylik', '2024-02-15'), {
        baslangic: '2024-02-01', bitis: '2024-02-29',
    });
    assert.equal(donemKaydir('aylik', '2026-01-31', 1), '2026-02-01');
});

test('yalnız geçerli öğrenci alışverişleri listelenir; yeni ve eski ürün kayıtları korunur', () => {
    const tarih = { toDate: () => new Date('2026-10-14T10:00:00Z') };
    const ogrenciler = [
        {
            id: 'ogr-1', adSoyad: 'Öğrenci Bir', sinif: '5/A',
            islemGecmisi: [
                { tarih, tip: 'Harcama', tutar: 25, aciklama: 'Kantin Alışverişi',
                    urunler: [{ ad: 'Meyve Suyu', miktar: 2 }] },
                { tarih, tip: 'Ödeme', tutar: -10, aciklama: 'Bisküvi (x1)' },
                { tarih, tip: 'Harcama', tutar: 12, aciklama: 'Kantin Alışverişi',
                    urunler: ['Kraker (x2)'] },
                { tarih, tip: 'Bakiye Yükleme', tutar: 100, aciklama: 'Yükleme' },
                { tarih, tip: 'Harcama', tutar: 50, aciklama: 'İptal', isCancelled: true },
            ],
        },
        { id: 'personel-1', tip: 'Personel', islemGecmisi: [
            { tarih, tip: 'Harcama', tutar: 5, aciklama: 'Kahve' },
        ] },
    ];
    const satirlar = harcamaSatirlariOlustur(ogrenciler);
    assert.equal(satirlar.length, 3);
    assert.deepEqual(satirlar.map(satir => satir.tutar), [25, 10, 12]);
    assert.deepEqual(satirlar.map(satir => satir.urunler), ['Meyve Suyu × 2', 'Bisküvi (x1)', 'Kraker (x2)']);
    assert.ok(satirlar.every(satir => satir.ogrenciId === 'ogr-1'));
});

test('ürün detayı olmayan eski satış açıkça işaretlenir', () => {
    const satirlar = harcamaSatirlariOlustur([{
        id: 'ogr-2', adSoyad: 'Öğrenci İki', islemGecmisi: [
            { tarih: { seconds: 1791986400 }, tip: 'Harcama', tutar: 8, aciklama: 'Kantin Alışverişi' },
        ],
    }]);
    assert.equal(satirlar[0].urunler, 'Ürün bilgisi kaydedilmemiş');
});
