import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter/foundation.dart';
import '../models/ogrenci.dart';
import '../models/urun.dart';

T? _ilkVeyaNull<T>(Iterable<T> degerler) =>
    degerler.isEmpty ? null : degerler.first;

class OdemeHatasi implements Exception {
  final String mesaj;
  final bool tekrarDenenebilir;
  OdemeHatasi(this.mesaj, {this.tekrarDenenebilir = false});

  @override
  String toString() => mesaj;
}

class OdemeSonucu {
  final String satisId;
  final double toplamTutar;
  final double yeniBakiye;
  final bool dahaOnceIslendi;
  final bool cevrimdisi;

  const OdemeSonucu({
    required this.satisId,
    required this.toplamTutar,
    required this.yeniBakiye,
    this.dahaOnceIslendi = false,
    this.cevrimdisi = false,
  });
}

class VeriYoneticisi extends ChangeNotifier {
  static final VeriYoneticisi _instance = VeriYoneticisi._internal();
  factory VeriYoneticisi() => _instance;
  VeriYoneticisi._internal();

  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  // Öğrenci verileri
  final Map<String, Ogrenci> ogrenciler = {};

  // Admin şifresi
  final String adminSifresi = '1234';

  // Ürün satış takibi
  final Map<String, int> urunSatislari = {};

  // Ürün Listesi (Firestore'dan gelecek)
  List<Urun> urunler = [];

  // OFFLINE DEPOLAMA
  SharedPreferences? _prefs;
  List<Map<String, dynamic>> _offlineIslemler = [];
  List<Map<String, dynamic>> _offlineSatislar = [];
  bool _internetVarMi = true;
  bool _ogrenciSunucuVerisiGeldi = false;
  bool _urunSunucuVerisiGeldi = false;
  bool _offlineSenkronizasyonCalisiyor = false;
  Timer? _senkronizasyonTimer;

  bool get internetVarMi => _internetVarMi;
  int get bekleyenOfflineSatisSayisi =>
      _offlineSatislar.where((s) => s['durum'] == 'bekliyor').length;
  int get mutabakatGerekenSatisSayisi =>
      _offlineSatislar.where((s) => s['durum'] == 'mutabakat_gerekli').length;

  // Firestore'dan verileri yükle
  Future<void> verileriYukle() async {
    _prefs = await SharedPreferences.getInstance();
    await _offlineIslemleriYukle();
    await _offlineSatislariYukle();
    await _offlineVerileriYukle();
    await _urunleriOfflineYukle();

    try {
      await Future.wait([
        _ogrencileriYukle(),
        _urunSatislariniYukle(),
        _urunleriYukle(), // Yeni ürün yükleme fonksiyonu
      ]);
      _internetVarMi = _ogrenciSunucuVerisiGeldi && _urunSunucuVerisiGeldi;
      print('✅ Firebase verileri yüklendi - Kart okuyucu hazır!');

      await _offlineIslemleriSenkronizeEt();
      await _offlineSatislariSenkronizeEt();
    } catch (e) {
      _internetVarMi = false;
      print(
          '⚠️ Firebase bağlanamadı - OFFLINE MODDA çalışıyor (${ogrenciler.length} öğrenci hazır)');
    }

    // Uygulama offline açılsa da ağ geri geldiğinde kuyruk kendiliğinden çalışır.
    _senkronizasyonTimer?.cancel();
    _senkronizasyonTimer =
        Timer.periodic(const Duration(seconds: 20), (_) async {
      await _offlineIslemleriSenkronizeEt();
      await _offlineSatislariSenkronizeEt();
    });
  }

  // Stream Subscriptions
  StreamSubscription? _ogrenciSubscription;
  StreamSubscription? _urunSubscription;

  Future<void> _ogrencileriYukle() async {
    final completer = Completer<void>();

    try {
      // Önceki dinlemeyi iptal et
      await _ogrenciSubscription?.cancel();

      // Real-time listener başlat
      _ogrenciSubscription =
          _firestore.collection('ogrenciler').snapshots().listen(
        (snapshot) {
          _ogrenciSunucuVerisiGeldi = !snapshot.metadata.isFromCache;
          _internetVarMi = _ogrenciSunucuVerisiGeldi && _urunSunucuVerisiGeldi;
          ogrenciler.clear();
          for (var doc in snapshot.docs) {
            final data = doc.data();
            final islemler = (data['islemGecmisi'] as List?)?.map((islem) {
                  return Islem(
                    satisId: islem['satisId'],
                    tarih: (islem['tarih'] as Timestamp).toDate(),
                    tip: islem['tip'],
                    tutar: (islem['tutar'] as num).toDouble(),
                    aciklama: islem['aciklama'],
                    toplamMaliyet: islem['toplamMaliyet'] != null
                        ? (islem['toplamMaliyet'] as num).toDouble()
                        : null,
                    urunler: (islem['urunler'] as List?)?.map((u) {
                      // Legacy support: old records stored plain strings like 'Eti Canga (x2)'
                      if (u is String) return u;
                      // New format: structured Map objects
                      return UrunKalemi.fromMap(
                          Map<String, dynamic>.from(u as Map));
                    }).toList(),
                    islemFotografi: islem['islemFotografi'],
                    senkronizasyonDurumu: 'tamamlandi',
                  );
                }).toList() ??
                [];

            final ogrenci = Ogrenci(
              kartID: doc.id,
              docID: doc.id,
              adSoyad: data['adSoyad'],
              sinif: data['sinif'],
              bakiye: (data['bakiye'] as num).toDouble(),
              islemGecmisi: islemler,
              tip: data['tip'],
            );

            // Döküman ID'siyle kaydet (her zaman)
            ogrenciler[doc.id] = ogrenci;

            // Eğer ayrıca bir kartID alanı varsa ve doc.id'den farklıysa,
            // onu da ekle — admin panelinden girilen kart numarasıyla eşleşsin
            final kartIDAlani = data['kartID']?.toString();
            if (kartIDAlani != null &&
                kartIDAlani.isNotEmpty &&
                kartIDAlani != doc.id) {
              ogrenciler[kartIDAlani] = ogrenci;
              print('🔗 Kart eşleşmesi: $kartIDAlani → ${ogrenci.adSoyad}');
            }
          }
          _bekleyenRezervasyonlariOgrencilereUygula();
          _ogrencileriOfflineKaydet();
          print('✅ ${snapshot.docs.length} öğrenci güncellendi (Stream)');
          notifyListeners();

          // İlk veri geldiğinde future'ı tamamla
          if (!completer.isCompleted) completer.complete();
        },
        onError: (e) {
          print('❌ Öğrenci stream hatası: $e');
          if (!completer.isCompleted) completer.completeError(e);
        },
      );

      // İlk veriyi bekle (maksimum 5 saniye)
      await completer.future.timeout(Duration(seconds: 5), onTimeout: () {
        print('⚠️ İlk veri yükleme zaman aşımı, ancak dinleme devam ediyor.');
      });
    } catch (e) {
      print('⚠️ Yeni öğrenci eklenirken hata (Offline): $e');
    }
    notifyListeners();
  }

  Future<void> _urunSatislariniYukle() async {
    try {
      final doc = await _firestore
          .collection('istatistikler')
          .doc('urunSatislari')
          .get();
      if (doc.exists) {
        final data = doc.data() as Map<String, dynamic>;
        data.forEach((key, value) {
          urunSatislari[key] = value as int;
        });
        print('✅ Ürün satışları Firestore\'dan yüklendi');
      }
    } catch (e) {
      print('❌ Ürün satışları yüklenirken hata: $e');
    }
  }

  Future<void> _urunleriYukle() async {
    final completer = Completer<void>();

    try {
      // Önceki dinlemeyi iptal et
      await _urunSubscription?.cancel();

      // Real-time listener başlat
      _urunSubscription = _firestore.collection('urunler').snapshots().listen(
        (snapshot) {
          _urunSunucuVerisiGeldi = !snapshot.metadata.isFromCache;
          _internetVarMi = _ogrenciSunucuVerisiGeldi && _urunSunucuVerisiGeldi;
          urunler.clear(); // Listeyi temizle ve yeniden oluştur

          for (var doc in snapshot.docs) {
            final data = doc.data();
            urunler.add(Urun(
              id: doc.id,
              isim: data['ad'] ?? 'İsimsiz Ürün',
              fiyat: (data['fiyat'] as num?)?.toDouble() ?? 0.0,
              maliyet: (data['maliyet'] as num?)?.toDouble() ?? 0.0,
              resimYolu: data['resimURL'] ?? '',
              kategori: data['kategori'] ?? 'Diğer',
              stok: (data['stok'] as int?) ?? 0,
            ));
          }

          _bekleyenRezervasyonlariUrunlereUygula();
          _urunleriOfflineKaydet();

          print('✅ ${urunler.length} ürün güncellendi (Stream)');
          notifyListeners();

          if (!completer.isCompleted) completer.complete();
        },
        onError: (e) {
          print('❌ Ürün stream hatası: $e');
          if (!completer.isCompleted) completer.completeError(e);
        },
      );

      // İlk veriyi bekle
      await completer.future.timeout(Duration(seconds: 5), onTimeout: () {
        print('⚠️ Ürün verisi yükleme zaman aşımı.');
      });
    } catch (e) {
      print('❌ Ürünler yüklenirken hata: $e');
    }
  }

  Ogrenci? ogrenciBul(String kartID) {
    return ogrenciler[kartID];
  }

  Future<double> bakiyeYukle(String kartID, double miktar) async {
    if (!miktar.isFinite || miktar <= 0) {
      throw OdemeHatasi('Yükleme tutarı pozitif bir sayı olmalıdır.');
    }
    final ogrenci = ogrenciler[kartID];
    if (ogrenci == null) throw OdemeHatasi('Hesap bulunamadı.');
    final posUid = FirebaseAuth.instance.currentUser?.uid;
    if (posUid == null) throw OdemeHatasi('POS Firebase oturumu yok.');

    final docRef = _firestore.collection('ogrenciler').doc(ogrenci.docID);
    final yuklemeId = 'yukleme_${DateTime.now().microsecondsSinceEpoch}';
    final yuklemeRef = _firestore.collection('bakiye_islemleri').doc(yuklemeId);
    double paraYuvarla(num value) => (value * 100).round() / 100.0;

    try {
      final yeniBakiye = await _firestore.runTransaction<double>((tx) async {
        final mevcutYukleme = await tx.get(yuklemeRef);
        if (mevcutYukleme.exists) {
          return (mevcutYukleme.data()!['yeniBakiye'] as num).toDouble();
        }
        final hesapSnap = await tx.get(docRef);
        if (!hesapSnap.exists) throw OdemeHatasi('Hesap sunucuda bulunamadı.');
        final eskiBakiye =
            paraYuvarla((hesapSnap.data()!['bakiye'] as num?) ?? 0);
        final yeniBakiye = paraYuvarla(eskiBakiye + miktar);
        final islem = {
          'islemId': yuklemeId,
          'tarih': Timestamp.now(),
          'tip': 'Bakiye Yükleme',
          'tutar': paraYuvarla(miktar),
          'aciklama': 'POS admin tarafından yüklendi',
          'isCancelled': false,
        };
        tx.update(docRef, {
          'bakiye': yeniBakiye,
          'islemGecmisi': FieldValue.arrayUnion([islem]),
        });
        tx.set(yuklemeRef, {
          'islemId': yuklemeId,
          'hesapId': ogrenci.docID,
          'kartID': kartID,
          'tutar': paraYuvarla(miktar),
          'eskiBakiye': eskiBakiye,
          'yeniBakiye': yeniBakiye,
          'tarih': FieldValue.serverTimestamp(),
          'posUid': posUid,
        });
        return yeniBakiye;
      });
      ogrenci.bakiye = yeniBakiye;
      await _ogrencileriOfflineKaydet();
      notifyListeners();
      return yeniBakiye;
    } on OdemeHatasi {
      rethrow;
    } catch (e) {
      print('❌ Bakiye yükleme hatası: $e');
      throw OdemeHatasi('Sunucu onayı alınamadı. Bakiye yüklenmedi.');
    }
  }

  /// Bakiyeyi, sunucu fiyatını ve tüm stokları tek transaction içinde
  /// kontrol eder. Aynı [satisId] yeniden gönderilirse ikinci kez tahsilat yapmaz.
  Future<OdemeSonucu> odemeYap(
    String kartID,
    List<SepetItem> sepet, {
    required String satisId,
    String? islemFotografiYolu,
    bool offlineFiyatSnapshotiniKullan = false,
  }) async {
    if (satisId.isEmpty) throw OdemeHatasi('Satış kimliği oluşturulamadı.');
    if (sepet.isEmpty) throw OdemeHatasi('Sepet boş.');

    final docID = ogrenciler[kartID]?.docID ?? kartID;
    final ogrenciRef = _firestore.collection('ogrenciler').doc(docID);
    final satisRef = _firestore.collection('satislar').doc(satisId);
    final posUid = FirebaseAuth.instance.currentUser?.uid;
    if (posUid == null) {
      throw OdemeHatasi(
        'POS cihazı şu anda Firebase oturumu açamadı.',
        tekrarDenenebilir: true,
      );
    }

    // Arayüzdeki değişebilir sepetten kopuk, ID bazlı sabit bir kopya.
    final Map<String, int> miktarlar = {};
    final Map<String, Urun> urunSnapshotlari = {};
    for (final item in sepet) {
      final urunId = item.urun.id;
      if (urunId == null || urunId.isEmpty || item.miktar <= 0) {
        throw OdemeHatasi('Sepette geçersiz ürün kaydı var. Ödeme yapılmadı.');
      }
      miktarlar[urunId] = (miktarlar[urunId] ?? 0) + item.miktar;
      urunSnapshotlari[urunId] = item.urun;
    }

    final urunRefs = <String, DocumentReference<Map<String, dynamic>>>{
      for (final id in miktarlar.keys)
        id: _firestore.collection('urunler').doc(id),
    };
    final ledgerRefs = <String, DocumentReference<Map<String, dynamic>>>{
      for (final id in miktarlar.keys)
        id: _firestore.collection('stok_hareketleri').doc('${satisId}_$id'),
    };

    double paraYuvarla(num value) => (value * 100).round() / 100.0;

    try {
      final sonuc =
          await _firestore.runTransaction<OdemeSonucu>((transaction) async {
        // Firestore transaction kuralı: bütün okumalar, yazmalardan önce.
        final mevcutSatis = await transaction.get(satisRef);
        if (mevcutSatis.exists) {
          final data = mevcutSatis.data()!;
          return OdemeSonucu(
            satisId: satisId,
            toplamTutar: (data['toplamTutar'] as num).toDouble(),
            yeniBakiye: (data['yeniBakiye'] as num).toDouble(),
            dahaOnceIslendi: true,
          );
        }

        final ogrenciSnap = await transaction.get(ogrenciRef);
        if (!ogrenciSnap.exists)
          throw OdemeHatasi('Kart sahibi sunucuda bulunamadı.');

        final urunSnaps = <String, DocumentSnapshot<Map<String, dynamic>>>{};
        for (final entry in urunRefs.entries) {
          urunSnaps[entry.key] = await transaction.get(entry.value);
        }

        final ogrenciData = ogrenciSnap.data()!;
        final oncekiBakiye = paraYuvarla((ogrenciData['bakiye'] as num?) ?? 0);
        final urunKalemleri = <Map<String, dynamic>>[];
        final istatistikUpdate = <String, dynamic>{};
        double toplamTutar = 0;
        double toplamMaliyet = 0;

        for (final entry in miktarlar.entries) {
          final snap = urunSnaps[entry.key]!;
          if (!snap.exists)
            throw OdemeHatasi('Sepetteki bir ürün artık sistemde yok.');

          final data = snap.data()!;
          final yerelSnapshot = urunSnapshotlari[entry.key]!;
          final ad = (offlineFiyatSnapshotiniKullan
                  ? yerelSnapshot.isim
                  : (data['ad'] ?? 'İsimsiz Ürün'))
              .toString();
          final stok = (data['stok'] as num?)?.toInt() ?? 0;
          final fiyat = paraYuvarla(offlineFiyatSnapshotiniKullan
              ? yerelSnapshot.fiyat
              : ((data['fiyat'] as num?) ?? 0));
          final maliyet = paraYuvarla(offlineFiyatSnapshotiniKullan
              ? yerelSnapshot.maliyet
              : ((data['maliyet'] as num?) ?? 0));
          final miktar = entry.value;

          if (stok < miktar)
            throw OdemeHatasi('Yetersiz stok: $ad (kalan $stok)');
          if (fiyat < 0 || maliyet < 0)
            throw OdemeHatasi('$ad için geçersiz fiyat/maliyet kaydı var.');

          final kalemTutari = paraYuvarla(fiyat * miktar);
          toplamTutar = paraYuvarla(toplamTutar + kalemTutari);
          toplamMaliyet = paraYuvarla(toplamMaliyet + (maliyet * miktar));
          urunKalemleri.add({
            'id': entry.key,
            'ad': ad,
            'miktar': miktar,
            'birimFiyat': fiyat,
            'birimMaliyet': maliyet,
            'toplamTutar': kalemTutari,
          });
          istatistikUpdate[ad] = FieldValue.increment(miktar);
        }

        final limit = ogrenciData['tip'] == 'Personel' ? -50.0 : -10.0;
        final yeniBakiye = paraYuvarla(oncekiBakiye - toplamTutar);
        if (yeniBakiye < limit) {
          throw OdemeHatasi(
            'Yetersiz bakiye. Mevcut: ${oncekiBakiye.toStringAsFixed(2)} TL, '
            'tutar: ${toplamTutar.toStringAsFixed(2)} TL.',
          );
        }

        final tarih = Timestamp.now();
        final aciklama =
            urunKalemleri.map((u) => '${u['ad']} (x${u['miktar']})').join(', ');
        final islem = <String, dynamic>{
          'satisId': satisId,
          'tarih': tarih,
          'tip': 'Harcama',
          'tutar': toplamTutar,
          'aciklama': aciklama,
          'toplamMaliyet': toplamMaliyet,
          'urunler': urunKalemleri,
          'isCancelled': false,
          if (islemFotografiYolu != null) 'islemFotografi': islemFotografiYolu,
        };

        transaction.update(ogrenciRef, {
          'bakiye': yeniBakiye,
          'islemGecmisi': FieldValue.arrayUnion([islem]),
        });

        for (final entry in miktarlar.entries) {
          final data = urunSnaps[entry.key]!.data()!;
          final eskiStok = (data['stok'] as num).toInt();
          final yeniStok = eskiStok - entry.value;
          transaction.update(urunRefs[entry.key]!, {'stok': yeniStok});
          transaction.set(ledgerRefs[entry.key]!, {
            'urunId': entry.key,
            'urunAdi': data['ad'],
            'miktarDegisimi': -entry.value,
            'eskiStok': eskiStok,
            'yeniStok': yeniStok,
            'tarih': FieldValue.serverTimestamp(),
            'islemTipi': 'Satış',
            'islemYapan': 'POS Tablet',
            'referansId': satisId,
            'posUid': posUid,
          });
        }

        transaction.set(
          _firestore.collection('istatistikler').doc('urunSatislari'),
          istatistikUpdate,
          SetOptions(merge: true),
        );
        transaction.set(satisRef, {
          'satisId': satisId,
          'ogrenciId': docID,
          'kartID': kartID,
          'ogrenciAdi': ogrenciData['adSoyad'] ?? '',
          'urunler': urunKalemleri,
          'toplamTutar': toplamTutar,
          'toplamMaliyet': toplamMaliyet,
          'oncekiBakiye': oncekiBakiye,
          'yeniBakiye': yeniBakiye,
          'tarih': FieldValue.serverTimestamp(),
          'durum': 'tamamlandi',
          'kaynak':
              offlineFiyatSnapshotiniKullan ? 'offline_pos' : 'online_pos',
          'posUid': posUid,
          if (islemFotografiYolu != null) 'islemFotografi': islemFotografiYolu,
        });

        return OdemeSonucu(
          satisId: satisId,
          toplamTutar: toplamTutar,
          yeniBakiye: yeniBakiye,
        );
      }).timeout(const Duration(seconds: 8));

      if (!sonuc.dahaOnceIslendi) {
        for (final item in sepet) {
          urunSatislari[item.urun.isim] =
              (urunSatislari[item.urun.isim] ?? 0) + item.miktar;
        }
      }
      notifyListeners();
      return sonuc;
    } on OdemeHatasi {
      rethrow;
    } on TimeoutException {
      throw OdemeHatasi(
        'Sunucuya ulaşılamadı; satış offline kasaya alınabilir.',
        tekrarDenenebilir: true,
      );
    } on FirebaseException catch (e) {
      final tekrarDenenebilir = {
        'unavailable',
        'deadline-exceeded',
        'network-request-failed',
        'aborted',
      }.contains(e.code);
      print('❌ Firebase ödeme hatası (${e.code}): ${e.message}');
      throw OdemeHatasi(
        tekrarDenenebilir
            ? 'Bağlantı yok; satış offline kasaya alınabilir.'
            : 'Sunucu işlemi reddetti (${e.code}). Satış yapılmadı.',
        tekrarDenenebilir: tekrarDenenebilir,
      );
    } catch (e) {
      print('❌ Ödeme hatası: $e');
      throw OdemeHatasi(
          'Sunucu işlemi onaylamadı. Bakiye ve stok değiştirilmedi.');
    }
  }

  /// Bağlantı yokken satışı dayanıklı yerel outbox'a yazar ve
  /// cihazdaki bakiye/stok kopyalarında rezervasyon oluşturur.
  Future<OdemeSonucu> cevrimdisiOdemeKaydet(
    String kartID,
    List<SepetItem> sepet, {
    required String satisId,
    String? islemFotografiYolu,
    String? yerelFotografYolu,
  }) async {
    if (_prefs == null) _prefs = await SharedPreferences.getInstance();
    final mevcut = _ilkVeyaNull(
      _offlineSatislar.where((s) => s['satisId'] == satisId),
    );
    if (mevcut != null) {
      return OdemeSonucu(
        satisId: satisId,
        toplamTutar: (mevcut['toplamTutar'] as num).toDouble(),
        yeniBakiye: (mevcut['yeniBakiye'] as num).toDouble(),
        dahaOnceIslendi: true,
        cevrimdisi: true,
      );
    }

    final ogrenci = ogrenciler[kartID];
    if (ogrenci == null)
      throw OdemeHatasi('Kart sahibi yerel kasada bulunamadı.');
    final miktarlar = <String, int>{};
    final snapshotlar = <String, Urun>{};
    for (final item in sepet) {
      final id = item.urun.id;
      if (id == null || id.isEmpty || item.miktar <= 0) {
        throw OdemeHatasi('Sepette geçersiz ürün var.');
      }
      miktarlar[id] = (miktarlar[id] ?? 0) + item.miktar;
      snapshotlar[id] = item.urun;
    }

    double yuvarla(num value) => (value * 100).round() / 100.0;
    double toplamTutar = 0;
    double toplamMaliyet = 0;
    final kalemler = <Map<String, dynamic>>[];
    for (final entry in miktarlar.entries) {
      final urun = snapshotlar[entry.key]!;
      final canliUrun = _ilkVeyaNull(urunler.where((u) => u.id == entry.key));
      final kullanilabilirStok = canliUrun?.stok ?? urun.stok;
      if (kullanilabilirStok < entry.value) {
        throw OdemeHatasi(
            'Yetersiz yerel stok: ${urun.isim} (kalan $kullanilabilirStok)');
      }
      final kalemTutari = yuvarla(urun.fiyat * entry.value);
      toplamTutar = yuvarla(toplamTutar + kalemTutari);
      toplamMaliyet = yuvarla(toplamMaliyet + (urun.maliyet * entry.value));
      kalemler.add({
        'id': entry.key,
        'ad': urun.isim,
        'miktar': entry.value,
        'birimFiyat': yuvarla(urun.fiyat),
        'birimMaliyet': yuvarla(urun.maliyet),
        'toplamTutar': kalemTutari,
        'resimYolu': urun.resimYolu,
        'kategori': urun.kategori,
      });
    }

    final limit = ogrenci.tip == 'Personel' ? -50.0 : -10.0;
    final oncekiBakiye = yuvarla(ogrenci.bakiye);
    final yeniBakiye = yuvarla(oncekiBakiye - toplamTutar);
    if (yeniBakiye < limit) {
      throw OdemeHatasi(
          'Yetersiz yerel bakiye. Mevcut: ${oncekiBakiye.toStringAsFixed(2)} TL');
    }

    final kaliciFotografYolu =
        await _offlineFotografiSakla(satisId, yerelFotografYolu);
    final kayit = <String, dynamic>{
      'surum': 2,
      'satisId': satisId,
      'kartID': kartID,
      'ogrenciId': ogrenci.docID,
      'ogrenciAdi': ogrenci.adSoyad,
      'urunler': kalemler,
      'toplamTutar': toplamTutar,
      'toplamMaliyet': toplamMaliyet,
      'oncekiBakiye': oncekiBakiye,
      'yeniBakiye': yeniBakiye,
      'yerelTarih': DateTime.now().toUtc().toIso8601String(),
      'durum': 'bekliyor',
      'denemeSayisi': 0,
      if (islemFotografiYolu != null) 'islemFotografi': islemFotografiYolu,
      if (kaliciFotografYolu != null) 'yerelFotografYolu': kaliciFotografYolu,
    };

    // Önce diske yaz; kalıcı kayıt başarısızsa yerel bakiyeyi değiştirme.
    _offlineSatislar.add(kayit);
    try {
      await _offlineSatislariKaydet();
    } catch (e) {
      _offlineSatislar.remove(kayit);
      throw OdemeHatasi('Offline satış diske kaydedilemedi; satış yapılmadı.');
    }

    ogrenci.bakiye = yeniBakiye;
    final aciklama =
        kalemler.map((u) => '${u['ad']} (x${u['miktar']})').join(', ');
    ogrenci.islemGecmisi.add(Islem(
      satisId: satisId,
      tarih: DateTime.now(),
      tip: 'Harcama',
      tutar: toplamTutar,
      aciklama: aciklama,
      toplamMaliyet: toplamMaliyet,
      urunler: kalemler.map((u) => UrunKalemi.fromMap(u)).toList(),
      islemFotografi: islemFotografiYolu,
      senkronizasyonDurumu: 'bekliyor',
    ));
    for (final entry in miktarlar.entries) {
      final urun = _ilkVeyaNull(urunler.where((u) => u.id == entry.key));
      if (urun != null) urun.stok -= entry.value;
    }
    await Future.wait([
      _ogrencileriOfflineKaydet(),
      _urunleriOfflineKaydet(),
    ]);
    _internetVarMi = false;
    notifyListeners();
    return OdemeSonucu(
      satisId: satisId,
      toplamTutar: toplamTutar,
      yeniBakiye: yeniBakiye,
      cevrimdisi: true,
    );
  }

  Future<String?> _offlineFotografiSakla(
      String satisId, String? kaynakYol) async {
    if (kaynakYol == null || kaynakYol.isEmpty) return null;
    try {
      final kaynak = File(kaynakYol);
      if (!await kaynak.exists()) return null;
      final anaDizin = await getApplicationDocumentsDirectory();
      final dizin = Directory('${anaDizin.path}/offline_satis_fotograflari');
      await dizin.create(recursive: true);
      final hedef = File('${dizin.path}/$satisId.jpg');
      await kaynak.copy(hedef.path);
      return hedef.path;
    } catch (e) {
      print('⚠️ Offline fotoğraf saklanamadı: $e');
      return null;
    }
  }

  Future<void> yeniOgrenciEkle(Ogrenci ogrenci) async {
    ogrenciler[ogrenci.kartID] = ogrenci;

    try {
      await _firestore.collection('ogrenciler').doc(ogrenci.kartID).set({
        'adSoyad': ogrenci.adSoyad,
        'sinif': ogrenci.sinif,
        'bakiye': ogrenci.bakiye,
        'islemGecmisi': [],
      });
      print('✅ Yeni öğrenci Firestore\'a eklendi: ${ogrenci.adSoyad}');
    } catch (e) {
      print('❌ Öğrenci ekleme hatası: $e');
    }
    notifyListeners();
  }

  // ===== OFFLINE FONKSİYONLARI =====

  Future<void> _offlineSatislariYukle() async {
    try {
      final jsonData = _prefs?.getString('offline_satislar_v2');
      if (jsonData == null || jsonData.isEmpty) return;
      final decoded = jsonDecode(jsonData) as List<dynamic>;
      _offlineSatislar = decoded
          .map((item) => Map<String, dynamic>.from(item as Map))
          .toList();
      print(
          '📥 ${_offlineSatislar.length} offline satış outbox kaydı yüklendi');
    } catch (e) {
      print('❌ Offline satış outbox okunamadı: $e');
      _offlineSatislar = [];
    }
  }

  Future<void> _offlineSatislariKaydet() async {
    final basarili = await _prefs?.setString(
      'offline_satislar_v2',
      jsonEncode(_offlineSatislar),
    );
    if (basarili != true) {
      throw StateError('Offline satış outbox diske yazılamadı.');
    }
  }

  Iterable<Map<String, dynamic>> get _aktifOfflineRezervasyonlar =>
      _offlineSatislar.where(
          (s) => s['durum'] == 'bekliyor' || s['durum'] == 'mutabakat_gerekli');

  bool _satisSunucudaGorunuyor(String satisId) {
    final gorulenHesaplar = <Ogrenci>{};
    for (final ogrenci in ogrenciler.values) {
      if (!gorulenHesaplar.add(ogrenci)) continue;
      if (ogrenci.islemGecmisi.any((i) =>
          i.satisId == satisId && i.senkronizasyonDurumu == 'tamamlandi'))
        return true;
    }
    return false;
  }

  void _bekleyenRezervasyonlariOgrencilereUygula() {
    for (final satis in _aktifOfflineRezervasyonlar) {
      final satisId = satis['satisId'].toString();
      if (_satisSunucudaGorunuyor(satisId)) continue;
      final kartID = satis['kartID'].toString();
      final docID = satis['ogrenciId'].toString();
      final ogrenci = ogrenciler[kartID] ?? ogrenciler[docID];
      if (ogrenci == null) continue;
      ogrenci.bakiye = (satis['yeniBakiye'] as num).toDouble();
      if (!ogrenci.islemGecmisi.any((i) => i.satisId == satisId)) {
        final kalemler = (satis['urunler'] as List<dynamic>)
            .map((u) => UrunKalemi.fromMap(Map<String, dynamic>.from(u as Map)))
            .toList();
        ogrenci.islemGecmisi.add(Islem(
          satisId: satisId,
          tarih: DateTime.parse(satis['yerelTarih']),
          tip: 'Harcama',
          tutar: (satis['toplamTutar'] as num).toDouble(),
          aciklama: kalemler.map((u) => '${u.ad} (x${u.miktar})').join(', '),
          toplamMaliyet: (satis['toplamMaliyet'] as num).toDouble(),
          urunler: kalemler,
          islemFotografi: satis['islemFotografi'],
          senkronizasyonDurumu: satis['durum'],
        ));
      }
    }
  }

  void _bekleyenRezervasyonlariUrunlereUygula() {
    final toplamRezervasyon = <String, int>{};
    for (final satis in _aktifOfflineRezervasyonlar) {
      if (_satisSunucudaGorunuyor(satis['satisId'].toString())) continue;
      for (final raw in satis['urunler'] as List<dynamic>) {
        final kalem = Map<String, dynamic>.from(raw as Map);
        final id = kalem['id'].toString();
        toplamRezervasyon[id] =
            (toplamRezervasyon[id] ?? 0) + (kalem['miktar'] as num).toInt();
      }
    }
    for (final urun in urunler) {
      final rezervasyon = toplamRezervasyon[urun.id] ?? 0;
      urun.stok = (urun.stok - rezervasyon).clamp(0, urun.stok).toInt();
    }
  }

  Future<void> _urunleriOfflineKaydet() async {
    try {
      final data = urunler
          .map((u) => {
                'id': u.id,
                'ad': u.isim,
                'fiyat': u.fiyat,
                'maliyet': u.maliyet,
                'resimYolu': u.resimYolu,
                'kategori': u.kategori,
                'stok': u.stok,
              })
          .toList();
      await _prefs?.setString('offline_urunler_v2', jsonEncode(data));
    } catch (e) {
      print('❌ Ürün offline cache yazılamadı: $e');
    }
  }

  Future<void> _urunleriOfflineYukle() async {
    try {
      final jsonData = _prefs?.getString('offline_urunler_v2');
      if (jsonData == null || jsonData.isEmpty) return;
      final data = jsonDecode(jsonData) as List<dynamic>;
      urunler = data.map((raw) {
        final u = Map<String, dynamic>.from(raw as Map);
        return Urun(
          id: u['id'],
          isim: u['ad'] ?? '',
          fiyat: (u['fiyat'] as num?)?.toDouble() ?? 0,
          maliyet: (u['maliyet'] as num?)?.toDouble() ?? 0,
          resimYolu: u['resimYolu'] ?? '',
          kategori: u['kategori'] ?? 'Diğer',
          stok: (u['stok'] as num?)?.toInt() ?? 0,
        );
      }).toList();
      print("📱 ${urunler.length} ürün offline cache'den yüklendi");
    } catch (e) {
      print('❌ Ürün offline cache okunamadı: $e');
    }
  }

  Future<void> _offlineSatislariSenkronizeEt() async {
    if (_offlineSenkronizasyonCalisiyor ||
        !_offlineSatislar.any((s) => s['durum'] == 'bekliyor')) return;
    _offlineSenkronizasyonCalisiyor = true;
    try {
      if (FirebaseAuth.instance.currentUser == null) {
        await FirebaseAuth.instance
            .signInAnonymously()
            .timeout(const Duration(seconds: 8));
      }
      for (final satis in List<Map<String, dynamic>>.from(_offlineSatislar)) {
        if (satis['durum'] != 'bekliyor') continue;
        final kalemler = (satis['urunler'] as List<dynamic>)
            .map((raw) => Map<String, dynamic>.from(raw as Map))
            .toList();
        final sepet = kalemler.map((u) {
          return SepetItem(
            urun: Urun(
              id: u['id'],
              isim: u['ad'],
              fiyat: (u['birimFiyat'] as num).toDouble(),
              maliyet: (u['birimMaliyet'] as num?)?.toDouble() ?? 0,
              resimYolu: u['resimYolu'] ?? '',
              kategori: u['kategori'] ?? 'Diğer',
              stok: 0,
            ),
            miktar: (u['miktar'] as num).toInt(),
          );
        }).toList(growable: false);
        try {
          final sonuc = await odemeYap(
            satis['kartID'],
            sepet,
            satisId: satis['satisId'],
            islemFotografiYolu: satis['islemFotografi'],
            offlineFiyatSnapshotiniKullan: true,
          );
          final yerelFotograf = satis['yerelFotografYolu']?.toString();
          final uzakFotograf = satis['islemFotografi']?.toString();
          if (yerelFotograf != null && uzakFotograf != null) {
            try {
              final dosya = File(yerelFotograf);
              if (await dosya.exists()) {
                await FirebaseStorage.instance
                    .ref()
                    .child(uzakFotograf)
                    .putFile(dosya);
                await dosya.delete();
              }
            } catch (e) {
              print('⚠️ Offline satış fotoğrafı yüklenemedi: $e');
            }
          }
          _offlineSatislar
              .removeWhere((item) => item['satisId'] == satis['satisId']);
          final ogrenci = ogrenciler[satis['kartID']];
          if (ogrenci != null) {
            ogrenci.bakiye = sonuc.yeniBakiye;
            for (final islem in ogrenci.islemGecmisi) {
              if (islem.satisId == satis['satisId']) {
                islem.senkronizasyonDurumu = 'tamamlandi';
              }
            }
          }
          await _offlineSatislariKaydet();
          _internetVarMi = true;
          print('✅ Offline satış senkronize edildi: ${satis['satisId']}');
        } on OdemeHatasi catch (e) {
          satis['denemeSayisi'] =
              ((satis['denemeSayisi'] as num?)?.toInt() ?? 0) + 1;
          satis['sonHata'] = e.mesaj;
          if (!e.tekrarDenenebilir) {
            satis['durum'] = 'mutabakat_gerekli';
            await _mutabakatKaydiYaz(satis, e.mesaj);
          }
          await _offlineSatislariKaydet();
          if (e.tekrarDenenebilir) break;
        }
      }
    } catch (e) {
      _internetVarMi = false;
      print('⚠️ Offline satış senkronizasyonu bekliyor: $e');
    } finally {
      _offlineSenkronizasyonCalisiyor = false;
      notifyListeners();
    }
  }

  Future<void> _mutabakatKaydiYaz(
      Map<String, dynamic> satis, String hata) async {
    try {
      final uid = FirebaseAuth.instance.currentUser?.uid;
      if (uid == null) return;
      await _firestore
          .collection('offline_mutabakatlar')
          .doc(satis['satisId'])
          .set({
        ...satis,
        'hata': hata,
        'posUid': uid,
        'bildirimTarihi': FieldValue.serverTimestamp(),
      });
    } catch (e) {
      print('⚠️ Mutabakat kaydı sunucuya yazılamadı: $e');
    }
  }

  Future<void> _offlineIslemleriYukle() async {
    try {
      final String? jsonData = _prefs?.getString('offline_islemler');
      if (jsonData != null) {
        final List<dynamic> decoded = jsonDecode(jsonData);
        _offlineIslemler = decoded.cast<Map<String, dynamic>>();
        print('📥 ${_offlineIslemler.length} offline işlem yüklendi');
      }
    } catch (e) {
      print('❌ Offline işlemler yüklenirken hata: $e');
      _offlineIslemler = [];
    }
  }

  Future<void> _offlineIslemleriKaydet() async {
    try {
      final String jsonData = jsonEncode(_offlineIslemler);
      await _prefs?.setString('offline_islemler', jsonData);
    } catch (e) {
      print('❌ Offline işlemler kaydedilirken hata: $e');
    }
  }

  Future<void> _ogrencileriOfflineKaydet() async {
    try {
      final Map<String, dynamic> data = {};
      ogrenciler.forEach((key, ogrenci) {
        data[key] = {
          'kartID': ogrenci.kartID,
          'docID': ogrenci.docID,
          'adSoyad': ogrenci.adSoyad,
          'sinif': ogrenci.sinif,
          'bakiye': ogrenci.bakiye,
          'tip': ogrenci.tip,
          'islemGecmisi': ogrenci.islemGecmisi
              .map((islem) => {
                    'satisId': islem.satisId,
                    'tarih': islem.tarih.toIso8601String(),
                    'tip': islem.tip,
                    'tutar': islem.tutar,
                    'aciklama': islem.aciklama,
                    if (islem.toplamMaliyet != null)
                      'toplamMaliyet': islem.toplamMaliyet,
                    'urunler': islem.urunler,
                    'islemFotografi': islem.islemFotografi,
                    'senkronizasyonDurumu': islem.senkronizasyonDurumu,
                  })
              .toList(),
        };
      });
      final String jsonData = jsonEncode(data);
      await _prefs?.setString('offline_ogrenciler', jsonData);
      print('💾 Öğrenci verileri offline kaydedildi');
    } catch (e) {
      print('❌ Offline kayıt hatası: $e');
    }
  }

  Future<void> _offlineVerileriYukle() async {
    try {
      final String? jsonData = _prefs?.getString('offline_ogrenciler');
      if (jsonData != null) {
        final Map<String, dynamic> data = jsonDecode(jsonData);
        ogrenciler.clear();
        data.forEach((key, value) {
          final islemler = (value['islemGecmisi'] as List).map((islem) {
            return Islem(
              satisId: islem['satisId'],
              tarih: DateTime.parse(islem['tarih']),
              tip: islem['tip'],
              tutar: islem['tutar'],
              aciklama: islem['aciklama'],
              toplamMaliyet: islem['toplamMaliyet'] != null
                  ? (islem['toplamMaliyet'] as num).toDouble()
                  : null,
              urunler: (islem['urunler'] as List?)?.map((u) {
                if (u is String) return u;
                return UrunKalemi.fromMap(Map<String, dynamic>.from(u as Map));
              }).toList(),
              islemFotografi: islem['islemFotografi'],
              senkronizasyonDurumu: islem['senkronizasyonDurumu'],
            );
          }).toList();

          ogrenciler[key] = Ogrenci(
            kartID: value['kartID'],
            docID: value['docID'] ?? value['kartID'],
            adSoyad: value['adSoyad'],
            sinif: value['sinif'],
            bakiye: (value['bakiye'] as num).toDouble(),
            islemGecmisi: islemler,
            tip: value['tip'],
          );
        });
        print('📱 ${ogrenciler.length} öğrenci OFFLINE verilerden yüklendi');
      }
    } catch (e) {
      print('❌ Offline veriler yüklenirken hata: $e');
    }
  }

  Future<void> _offlineIslemEkle(Map<String, dynamic> islem) async {
    _offlineIslemler.add(islem);
    await _offlineIslemleriKaydet();
    print('💾 Offline işlem kaydedildi (Toplam: ${_offlineIslemler.length})');
  }

  Future<void> _offlineIslemleriSenkronizeEt() async {
    if (_offlineIslemler.isEmpty) return;
    await _prefs?.setString(
      'offline_islemler_karantina',
      jsonEncode(_offlineIslemler),
    );
    print(
        '⚠️ ${_offlineIslemler.length} eski offline mali işlem karantinaya alındı.');
    _offlineIslemler.clear();
    await _offlineIslemleriKaydet();
  }
}
