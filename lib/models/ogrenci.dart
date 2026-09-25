/// Structured product line-item saved in every checkout transaction.
/// New records use this format; legacy records used plain strings.
class UrunKalemi {
  String id; // Firestore document ID of the product
  String ad; // Product name snapshot at time of purchase
  int miktar; // Quantity purchased
  double birimFiyat; // Unit selling price at time of purchase
  double toplamTutar; // miktar × birimFiyat

  UrunKalemi({
    required this.id,
    required this.ad,
    required this.miktar,
    required this.birimFiyat,
    required this.toplamTutar,
  });

  Map<String, dynamic> toMap() => {
        'id': id,
        'ad': ad,
        'miktar': miktar,
        'birimFiyat': birimFiyat,
        'toplamTutar': toplamTutar,
      };

  factory UrunKalemi.fromMap(Map<String, dynamic> map) => UrunKalemi(
        id: map['id'] ?? '',
        ad: map['ad'] ?? '',
        miktar: (map['miktar'] as num?)?.toInt() ?? 1,
        birimFiyat: (map['birimFiyat'] as num?)?.toDouble() ?? 0.0,
        toplamTutar: (map['toplamTutar'] as num?)?.toDouble() ?? 0.0,
      );
}

class Ogrenci {
  String kartID; // Karttan okunan ID (veya doc.id)
  String docID; // Firestore döküman ID'si (her zaman doc.id)
  String adSoyad;
  String sinif;
  double bakiye;
  List<Islem> islemGecmisi;
  String? tip; // 'Personel' veya 'Öğrenci'

  Ogrenci({
    required this.kartID,
    String? docID,
    required this.adSoyad,
    required this.sinif,
    this.bakiye = 0.0,
    List<Islem>? islemGecmisi,
    this.tip,
  })  : docID = docID ?? kartID,
        islemGecmisi = islemGecmisi ?? [];
}

class Islem {
  String? satisId;
  DateTime tarih;
  String tip; // 'Bakiye Yükleme', 'Ödeme', 'Harcama'
  double tutar;
  String aciklama;
  double?
      toplamMaliyet; // ✅ Immutable COGS snapshot — set at checkout, null for legacy records
  /// New format: List<UrunKalemi> — structured objects with id, ad, miktar, birimFiyat, toplamTutar.
  /// Legacy format (pre-2026-06): List<String> with format "ProductName (x2)".
  List<dynamic>? urunler;
  String? islemFotografi; // İşlem anındaki fotoğraf yolu
  String? senkronizasyonDurumu; // bekliyor, tamamlandi, mutabakat_gerekli

  Islem({
    required this.tarih,
    required this.tip,
    required this.tutar,
    required this.aciklama,
    this.satisId,
    this.toplamMaliyet,
    this.urunler,
    this.islemFotografi,
    this.senkronizasyonDurumu,
  });
}
