import 'dart:async';
import 'dart:io';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:path_provider/path_provider.dart';

/// Satıştan bağımsız, dosya tabanlı fotoğraf kuyruğu. Her JPEG, sunucu
/// onaylayana kadar uygulamanın kalıcı belgeler klasöründe tutulur.
class FotografYuklemeServisi {
  FotografYuklemeServisi._();
  static final FotografYuklemeServisi instance = FotografYuklemeServisi._();

  static const String _sunucu = String.fromEnvironment(
    'PHOTO_SERVER_URL',
    defaultValue: 'https://fotograf.tugaybilsemkantin.com.tr',
  );
  static final RegExp _satisId = RegExp(r'^[A-Za-z0-9_-]{1,100}$');
  Directory? _dizin;
  Timer? _timer;
  bool _calisiyor = false;
  final Map<String, DateTime> _sonrakiDeneme = {};

  Future<void> baslat() async {
    if (_dizin != null) return;
    final belgeler = await getApplicationDocumentsDirectory();
    final dizin = Directory('${belgeler.path}/bekleyen_satis_fotograflari');
    await dizin.create(recursive: true);
    _dizin = dizin;

    // Eski sürümün offline satıştan sonra yükleyemediği fotoğrafları kurtar.
    final eskiDizin = Directory('${belgeler.path}/offline_satis_fotograflari');
    if (await eskiDizin.exists()) {
      await for (final item in eskiDizin.list()) {
        if (item is! File) continue;
        final ad = item.uri.pathSegments.last;
        if (!ad.endsWith('.jpg')) continue;
        final id = ad.substring(0, ad.length - 4);
        if (!_satisId.hasMatch(id)) continue;
        final hedef = File('${dizin.path}/$ad');
        if (!await hedef.exists()) {
          try {
            await item.rename(hedef.path);
          } catch (e) {
            print('⚠️ Eski fotoğraf taşınamadı: $e');
          }
        }
      }
    }
    _timer ??= Timer.periodic(const Duration(seconds: 30), (_) => yenidenDene());
    yenidenDene();
  }

  Future<void> fotografiSakla(String satisId, String kaynakYol) async {
    if (!_satisId.hasMatch(satisId)) throw ArgumentError('Geçersiz satış kimliği.');
    await baslat();
    final hedef = File('${_dizin!.path}/$satisId.jpg');
    if (await hedef.exists()) return;
    final gecici = File('${_dizin!.path}/.$satisId.tmp');
    try {
      await File(kaynakYol).copy(gecici.path);
      await gecici.rename(hedef.path);
    } finally {
      if (await gecici.exists()) await gecici.delete();
    }
  }

  void yenidenDene() {
    unawaited(_bekleyenleriGonder());
  }

  void satisKaydiHazir(String satisId) {
    if (_dizin != null && _satisId.hasMatch(satisId)) {
      _sonrakiDeneme.remove('${_dizin!.path}/$satisId.jpg');
    }
    yenidenDene();
  }

  Future<void> _bekleyenleriGonder() async {
    if (_calisiyor || _dizin == null || !_sunucu.startsWith('https://')) return;
    _calisiyor = true;
    try {
      final kullanici = FirebaseAuth.instance.currentUser;
      if (kullanici == null) return;
      final simdi = DateTime.now();
      final dosyalar = await _dizin!.list().where((item) => item is File &&
          item.path.endsWith('.jpg') &&
          !(_sonrakiDeneme[item.path]?.isAfter(simdi) ?? false))
          .cast<File>().take(3).toList();
      for (final dosya in dosyalar) {
        final ad = dosya.uri.pathSegments.last;
        final satisId = ad.substring(0, ad.length - 4);
        if (!_satisId.hasMatch(satisId)) continue;
        final client = HttpClient()..connectionTimeout = const Duration(seconds: 5);
        try {
          final token = await kullanici.getIdToken();
          final uri = Uri.parse('$_sunucu/photos/$satisId');
          final request = await client.putUrl(uri).timeout(const Duration(seconds: 8));
          request.headers.set(HttpHeaders.authorizationHeader, 'Bearer $token');
          request.headers.contentType = ContentType('image', 'jpeg');
          request.contentLength = await dosya.length();
          await request.addStream(dosya.openRead());
          final response = await request.close().timeout(const Duration(seconds: 15));
          await response.drain<void>();
          if (response.statusCode == HttpStatus.ok) {
            await dosya.delete();
            _sonrakiDeneme.remove(dosya.path);
          } else {
            _sonrakiDeneme[dosya.path] =
                DateTime.now().add(const Duration(minutes: 2));
            print('⚠️ Fotoğraf gönderimi bekliyor ($satisId): ${response.statusCode}');
          }
        } catch (e) {
          _sonrakiDeneme[dosya.path] =
              DateTime.now().add(const Duration(minutes: 2));
          print('⚠️ Fotoğraf gönderimi daha sonra denenecek ($satisId): $e');
        } finally {
          client.close(force: true);
        }
      }
    } catch (e) {
      print('⚠️ Fotoğraf kuyruğu okunamadı: $e');
    } finally {
      _calisiyor = false;
    }
  }
}
