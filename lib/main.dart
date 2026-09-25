import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:camera/camera.dart';
import 'package:uuid/uuid.dart';
import 'dart:io';
import 'firebase_options.dart';

// Model imports
import 'models/ogrenci.dart';
import 'models/urun.dart';

// Service imports
import 'services/veri_yoneticisi.dart';
import 'services/update_service.dart';

// Data imports
import 'data/urunler.dart' as Data;

CameraController? globalCameraController;
List<CameraDescription>? cameras;

class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback =
          (X509Certificate cert, String host, int port) => true;
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  HttpOverrides.global = MyHttpOverrides();

  // KIOSK MODU - Cihazın navigasyon barını ve üst statüs çubuğunu gizler
  SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);

  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );

  // POS kuralları her cihazı kalıcı bir Firebase UID ile tanır.
  try {
    if (FirebaseAuth.instance.currentUser == null) {
      await FirebaseAuth.instance
          .signInAnonymously()
          .timeout(const Duration(seconds: 5));
    }
    print('🔐 POS Firebase UID: ${FirebaseAuth.instance.currentUser?.uid}');
  } catch (e) {
    // Uygulama açılır; ancak odemeYap oturum yokken kesinlikle tahsilat yapmaz.
    print('❌ POS Firebase oturumu açılamadı: $e');
  }

  try {
    cameras = await availableCameras();
    if (cameras != null && cameras!.isNotEmpty) {
      // Try to find front camera
      CameraDescription? frontCamera;
      for (var camera in cameras!) {
        if (camera.lensDirection == CameraLensDirection.front) {
          frontCamera = camera;
          break;
        }
      }

      globalCameraController = CameraController(
        frontCamera ?? cameras!.first,
        ResolutionPreset.medium,
        enableAudio: false,
      );
      await globalCameraController!.initialize();
      print("📸 Kamera başlatıldı");
    }
  } catch (e) {
    print("⚠️ Kamera başlatılamadı: $e");
  }

  runApp(const OkulOtomatApp());
}

// --- UYGULAMA ---
class OkulOtomatApp extends StatelessWidget {
  const OkulOtomatApp({Key? key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    // Tüm yönleri destekle - tablet ve telefon için
    SystemChrome.setPreferredOrientations([
      DeviceOrientation.portraitUp,
      DeviceOrientation.portraitDown,
      DeviceOrientation.landscapeLeft,
      DeviceOrientation.landscapeRight,
    ]);

    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Okul Otomat',
      theme: ThemeData(
        primarySwatch: Colors.indigo,
        fontFamily: 'Inter',
      ),
      home: AnaSayfaSecim(),
      routes: {
        '/admin': (context) => AdminPaneli(),
        '/ogrenci': (context) => UrunListesiEkrani(),
      },
    );
  }
}

// Ana Sayfa Seçim Ekranı
class AnaSayfaSecim extends StatefulWidget {
  const AnaSayfaSecim({Key? key}) : super(key: key);

  @override
  State<AnaSayfaSecim> createState() => _AnaSayfaSecimState();
}

class _AnaSayfaSecimState extends State<AnaSayfaSecim> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      UpdateService.checkForUpdates(context);
    });
  }

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;
    final screenHeight = MediaQuery.of(context).size.height;
    final isTablet = screenWidth > 600;

    return Scaffold(
      body: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [Colors.indigo.shade400, Colors.purple.shade300],
          ),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              child: Padding(
                padding: EdgeInsets.all(isTablet ? 40.0 : 20.0),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SizedBox(height: isTablet ? 20 : 10),
                    Text(
                      'OKUL OTOMAT',
                      style: TextStyle(
                        fontSize: isTablet ? 56 : 32,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                        letterSpacing: 2,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    SizedBox(height: isTablet ? 20 : 10),
                    Text(
                      'Lütfen kullanıcı tipinizi seçin',
                      style: TextStyle(
                        fontSize: isTablet ? 24 : 16,
                        color: Colors.white70,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    SizedBox(height: isTablet ? 60 : 30),
                    // Responsive layout - telefonda Column, tablette Row
                    isTablet
                        ? Row(
                            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                            children: [
                              // Admin Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'ADMİN',
                                icon: Icons.admin_panel_settings,
                                renk: Colors.red,
                                isTablet: isTablet,
                                onTap: () {
                                  _sifreGir(context);
                                },
                              ),
                              // Öğrenci Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'ÖĞRENCİ',
                                icon: Icons.school,
                                renk: Colors.blue,
                                isTablet: isTablet,
                                onTap: () {
                                  Navigator.pushReplacement(
                                    context,
                                    MaterialPageRoute(
                                        builder: (context) =>
                                            UrunListesiEkrani()),
                                  );
                                },
                              ),
                              // Veli Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'VELİ',
                                icon: Icons.family_restroom,
                                renk: Colors.green,
                                isTablet: isTablet,
                                onTap: () {
                                  _veliEkrani(context);
                                },
                              ),
                            ],
                          )
                        : Column(
                            children: [
                              // Admin Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'ADMİN',
                                icon: Icons.admin_panel_settings,
                                renk: Colors.red,
                                isTablet: isTablet,
                                onTap: () {
                                  _sifreGir(context);
                                },
                              ),
                              SizedBox(height: 20),
                              // Öğrenci Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'ÖĞRENCİ',
                                icon: Icons.school,
                                renk: Colors.blue,
                                isTablet: isTablet,
                                onTap: () {
                                  Navigator.pushReplacement(
                                    context,
                                    MaterialPageRoute(
                                        builder: (context) =>
                                            UrunListesiEkrani()),
                                  );
                                },
                              ),
                              SizedBox(height: 20),
                              // Veli Kartı
                              _buildKullaniciKarti(
                                context,
                                baslik: 'VELİ',
                                icon: Icons.family_restroom,
                                renk: Colors.green,
                                isTablet: isTablet,
                                onTap: () {
                                  _veliEkrani(context);
                                },
                              ),
                            ],
                          ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildKullaniciKarti(
    BuildContext context, {
    required String baslik,
    required IconData icon,
    required Color renk,
    required bool isTablet,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Container(
        width: isTablet ? 280 : MediaQuery.of(context).size.width * 0.85,
        height: isTablet ? 350 : 180,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(isTablet ? 25 : 20),
          boxShadow: [
            BoxShadow(
              color: Colors.black26,
              blurRadius: 15,
              offset: Offset(0, 8),
            ),
          ],
        ),
        child: isTablet
            ? Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Container(
                    width: 140,
                    height: 140,
                    decoration: BoxDecoration(
                      color: renk.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      icon,
                      size: 80,
                      color: renk,
                    ),
                  ),
                  SizedBox(height: 30),
                  Text(
                    baslik,
                    style: TextStyle(
                      fontSize: 32,
                      fontWeight: FontWeight.bold,
                      color: renk,
                      letterSpacing: 1.5,
                    ),
                  ),
                ],
              )
            : Row(
                children: [
                  SizedBox(width: 20),
                  Container(
                    width: 100,
                    height: 100,
                    decoration: BoxDecoration(
                      color: renk.withOpacity(0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      icon,
                      size: 50,
                      color: renk,
                    ),
                  ),
                  SizedBox(width: 20),
                  Expanded(
                    child: Text(
                      baslik,
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: renk,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ),
                  SizedBox(width: 20),
                ],
              ),
      ),
    );
  }

  void _sifreGir(BuildContext context) {
    final sifreController = TextEditingController();
    final sifreFocusNode = FocusNode();
    bool dialogClosed = false;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) {
        // Dialog açıldığında klavyeyi zorla aç
        Future.delayed(Duration(milliseconds: 100), () {
          if (!dialogClosed) {
            sifreFocusNode.requestFocus();
            SystemChannels.textInput.invokeMethod('TextInput.show');
          }
        });

        // Kart okuyucu listener - Admin kartı okutulursa otomatik giriş
        sifreController.addListener(() {
          if (dialogClosed) return;

          final text = sifreController.text.trim();
          // Admin şifresi girilirse otomatik giriş yap
          if (text == VeriYoneticisi().adminSifresi) {
            dialogClosed = true;
            // Listener içinde dispose YAPMA - Future.microtask ile sonraya ertele
            Future.microtask(() {
              sifreController.dispose();
              sifreFocusNode.dispose();
            });
            Navigator.pop(dialogContext);
            Navigator.pushReplacement(
              context,
              MaterialPageRoute(builder: (context) => AdminPaneli()),
            );
          }
        });

        return GestureDetector(
          onTap: () {
            // Dialog'a her tıklamada focus'u şifre alanına ver
            if (!dialogClosed) {
              sifreFocusNode.requestFocus();
              SystemChannels.textInput.invokeMethod('TextInput.show');
            }
          },
          child: AlertDialog(
            title: Text('Admin Girişi'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                TextField(
                  controller: sifreController,
                  focusNode: sifreFocusNode,
                  obscureText: true,
                  keyboardType: TextInputType.number,
                  textInputAction: TextInputAction.done,
                  decoration: InputDecoration(
                    labelText: 'Admin Şifresi',
                    border: OutlineInputBorder(),
                  ),
                  onSubmitted: (value) {
                    if (!dialogClosed &&
                        value == VeriYoneticisi().adminSifresi) {
                      dialogClosed = true;
                      Future.microtask(() {
                        sifreController.dispose();
                        sifreFocusNode.dispose();
                      });
                      Navigator.pop(dialogContext);
                      Navigator.pushReplacement(
                        context,
                        MaterialPageRoute(builder: (context) => AdminPaneli()),
                      );
                    }
                  },
                ),
                SizedBox(height: 10),
                Text(
                  'Admin bölümüne girmek için şifrenizi girin',
                  style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () {
                  if (!dialogClosed) {
                    dialogClosed = true;
                    Navigator.pop(dialogContext);
                    Future.microtask(() {
                      sifreController.dispose();
                      sifreFocusNode.dispose();
                    });
                  }
                },
                child: Text('İptal'),
              ),
              ElevatedButton(
                onPressed: () {
                  if (!dialogClosed) {
                    if (sifreController.text == VeriYoneticisi().adminSifresi) {
                      dialogClosed = true;
                      Future.microtask(() {
                        sifreController.dispose();
                        sifreFocusNode.dispose();
                      });
                      Navigator.pop(dialogContext);
                      Navigator.pushReplacement(
                        context,
                        MaterialPageRoute(builder: (context) => AdminPaneli()),
                      );
                    } else {
                      dialogClosed = true;
                      Future.microtask(() {
                        sifreController.dispose();
                        sifreFocusNode.dispose();
                      });
                      Navigator.pop(dialogContext);
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Hatalı şifre!')),
                      );
                    }
                  }
                },
                child: Text('Giriş'),
              ),
            ],
          ),
        );
      },
    );
  }

  void _veliEkrani(BuildContext context) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Veli Paneli'),
        content: Text(
          'Veli paneli yakında eklenecek.\n\nBu bölümden:\n• Öğrenci bakiyesi görüntüleme\n• Harcama detayları\n• Bakiye yükleme\nişlemleri yapılabilecek.',
          style: TextStyle(fontSize: 16),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text('Tamam'),
          ),
        ],
      ),
    );
  }
}

// --- Veri Modelleri ---
// Modeller lib/models/urun.dart dosyasından import edilmiştir.

// --- Ana Ekran ---
class UrunListesiEkrani extends StatefulWidget {
  const UrunListesiEkrani({Key? key}) : super(key: key);

  @override
  State<UrunListesiEkrani> createState() => _UrunListesiEkraniState();
}

class _UrunListesiEkraniState extends State<UrunListesiEkrani> {
  // Kart okuyucudan gelen veriyi yakalamak için
  final FocusNode _focusNode = FocusNode();
  final TextEditingController _kartOkuyucuController = TextEditingController();

  // RAW KEYBOARD LISTENER İÇİN
  final StringBuffer _kartBuffer = StringBuffer();
  DateTime _lastKeyPress = DateTime.now();

  Timer? _debounceTimer;
  Timer? _cartIdleTimer; // 5 dakika boşta kalırsa sepeti otomatik temizle

  String? secilenKategori; // Hangi kategori seçili
  bool _verilerYuklendi = false; // Firebase verileri yüklendi mi?

  // Dialog durumları
  bool _odemeDialogAcik = false;
  bool _bakiyeDialogAcik = false;
  bool _odemeIsleniyor = false;

  // Debug ve Status
  String _statusMesaji = 'Başlatılıyor...';
  Color _statusRenk = Colors.orange;

  @override
  void initState() {
    super.initState();

    // Android sistem tuşlarını gizle (ana sayfa, geri, son uygulamalar)
    SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.immersiveSticky,
      overlays: [],
    );

    // Firebase verilerini yükle
    VeriYoneticisi().addListener(_veriDurumuDegisti);
    _firebaseVerileriniYukle();

    // Kart okuyucu listener - Her zaman aktif
    _kartOkuyucuController.addListener(() {
      String metin = _kartOkuyucuController.text.trim();

      if (metin.isEmpty) return;

      // Kart ID'yi temizle (ardışık tekrarları kaldır)
      String temizKartID = '';
      for (int i = 0; i < metin.length; i++) {
        if (i == 0 || metin[i] != metin[i - 1]) {
          temizKartID += metin[i];
        }
      }

      print('🔍 KART OKUYUCU: "${metin}" (Uzunluk: ${metin.length})');
      print('📝 HAM VERİ: "${_kartOkuyucuController.text}"');

      // Dialog açıksa direkt işle
      if (_odemeDialogAcik && metin.length >= 10) {
        // Okuyucu bazen karakterleri parça parça yollar. Son karakterden sonra
        // tek bir olay üret; TextField içinden ikinci bir ödeme tetiklenmez.
        _debounceTimer?.cancel();
        _debounceTimer = Timer(const Duration(milliseconds: 150), () {
          if (!mounted || !_odemeDialogAcik || _odemeIsleniyor) return;
          final okunanKart = _kartOkuyucuController.text.trim();
          if (okunanKart.length < 10) return;
          _odemeDialogAcik = false;
          Navigator.of(context, rootNavigator: true).pop();
          _kartOkuyucuController.clear();
          _kartIsleminiYap(okunanKart);
        });
        return;
      }

      if (_bakiyeDialogAcik && metin.length >= 10) {
        print('💰 BAKİYE DIALOG - Kart okundu: $metin');
        Navigator.of(context, rootNavigator: true).pop(); // Dialog'u kapat
        _bakiyeSorgula(metin);
        _kartOkuyucuController.clear();
        _bakiyeDialogAcik = false;
        return;
      }

      // Normal durum - ana ekran
      if (metin.length >= 10) {
        print('✅ 10+ karakter, timer başlatıldı');
        _debounceTimer?.cancel();
        _debounceTimer = Timer(const Duration(milliseconds: 200), () {
          print('⏰ Timer tetiklendi, işlem başlıyor: $metin');
          if (mounted && metin.isNotEmpty) {
            _kartOkutuldu(metin);
            _kartOkuyucuController.clear();
          }
        });
      }
    });

    // Ekran yüklendiğinde focus'u kart okuyucuya ver
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _focusNode.requestFocus();
    });
  }

  void _veriDurumuDegisti() {
    if (!mounted) return;
    final veri = VeriYoneticisi();
    setState(() {
      if (veri.mutabakatGerekenSatisSayisi > 0) {
        _statusMesaji =
            'Mutabakat gerekli: ${veri.mutabakatGerekenSatisSayisi} satış';
        _statusRenk = Colors.red;
      } else if (veri.bekleyenOfflineSatisSayisi > 0) {
        _statusMesaji =
            'Çevrimdışı • ${veri.bekleyenOfflineSatisSayisi} satış bekliyor';
        _statusRenk = Colors.orange;
      } else if (!veri.internetVarMi) {
        _statusMesaji = 'Çevrimdışı • Satışa hazır';
        _statusRenk = Colors.orange;
      } else {
        _statusMesaji = 'Online (${veri.ogrenciler.length} Öğrenci)';
        _statusRenk = Colors.green;
      }
    });
  }

  // Firebase verilerini yükle
  Future<void> _firebaseVerileriniYukle() async {
    print("🔄 Firebase verileri yükleniyor...");
    await VeriYoneticisi().verileriYukle();
    setState(() {
      _verilerYuklendi = true;
    });
    print("✅ Firebase verileri yüklendi - Kart okuyucu hazır!");

    _veriDurumuDegisti();
  }

  Future<void> _verileriYenile() async {
    setState(() {
      _statusMesaji = 'Yenileniyor...';
      _statusRenk = Colors.orange;
    });

    await VeriYoneticisi().verileriYukle();

    _veriDurumuDegisti();
  }

  // ── Sepet boşta kalma zamanlayıcısı ──────────────────────────────────────

  /// Sepete her ürün eklenişinde veya miktarı değiştiğinde çağrılır.
  /// 5 dakikalık geri sayımı sıfırlar.
  void _resetCartTimer() {
    _cartIdleTimer?.cancel();
    _cartIdleTimer = Timer(const Duration(minutes: 5), () {
      if (!mounted) return;
      print('⏰ Sepet 5 dakika boşta kaldı — otomatik temizleniyor.');
      setState(() {
        sepet.clear();
        toplamTutar = 0.0;
        secilenKategori = null;
      });
      // Kullanıcıya bilgi ver
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sepet zaman aşımından dolayı temizlendi.'),
            backgroundColor: Colors.orange,
            duration: Duration(seconds: 4),
          ),
        );
      }
    });
  }

  /// Başarılı ödeme veya manuel temizlemede zamanlayıcıyı durdurur.
  void _cancelCartTimer() {
    _cartIdleTimer?.cancel();
    _cartIdleTimer = null;
  }

  // ─────────────────────────────────────────────────────────────────────────

  @override
  void dispose() {
    // Sistem tuşlarını geri aç
    SystemChrome.setEnabledSystemUIMode(
      SystemUiMode.edgeToEdge,
      overlays: SystemUiOverlay.values,
    );

    _debounceTimer?.cancel();
    _cartIdleTimer?.cancel(); // Boşta kalma zamanlayıcısını temizle
    VeriYoneticisi().removeListener(_veriDurumuDegisti);
    _kartOkuyucuController.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  // Kategoriler
  final List<Kategori> kategoriler = [
    Kategori(
        isim: 'İçecekler',
        icon: Icons.local_drink,
        renk: Colors.blue,
        resimYolu: 'assets/images/beypazarı.png'),
    Kategori(
        isim: 'Atıştırmalıklar',
        icon: Icons.cookie,
        renk: Colors.orange,
        resimYolu: 'assets/images/ruffles.jpg'),
    Kategori(
        isim: 'Tatlılar',
        icon: Icons.cake,
        renk: Colors.red,
        resimYolu: 'assets/images/tutku.jpg'),
    Kategori(
        isim: 'Gofretler',
        icon: Icons.fastfood,
        renk: Colors.brown,
        resimYolu: 'assets/images/gofret.png'),
    Kategori(
        isim: 'Kekler',
        icon: Icons.breakfast_dining,
        renk: Colors.yellow,
        resimYolu: 'assets/images/tutku.jpg'),
    Kategori(
        isim: 'Krakerler',
        icon: Icons.bakery_dining,
        renk: Colors.orangeAccent,
        resimYolu: 'assets/images/çizi cips.png'),
    Kategori(
        isim: 'Çikolatalar',
        icon: Icons.icecream,
        renk: Colors.brown,
        resimYolu: 'assets/images/biskrem.png'),
  ];

  // Firestore'dan gelen ürünleri kullan
  List<Urun> get urunler => VeriYoneticisi().urunler;

  List<SepetItem> sepet = [];
  double toplamTutar = 0.0;

  // --- Sepet Fonksiyonları (Aynı) ---
  void hesaplaToplamTutar() {
    double yeniToplam = 0.0;
    for (var sepetOgesi in sepet) {
      yeniToplam += sepetOgesi.urun.fiyat * sepetOgesi.miktar;
    }
    setState(() {
      toplamTutar = yeniToplam;
    });
  }

  void sepeteEkle(Urun urun) {
    int index = sepet.indexWhere((item) => item.urun.isim == urun.isim);
    final mevcutMiktar = index == -1 ? 0 : sepet[index].miktar;
    if (urun.stok <= 0 || mevcutMiktar >= urun.stok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${urun.isim} için mevcut stok sınırına ulaşıldı.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }
    setState(() {
      if (index != -1) {
        sepet[index].miktar++;
      } else {
        sepet.add(SepetItem(urun: urun, miktar: 1));
      }
    });
    hesaplaToplamTutar();
    _resetCartTimer(); // Boşta kalma zamanlayıcısını sıfırla
  }

  void sepettenCikar(Urun urun) {
    int index = sepet.indexWhere((item) => item.urun.isim == urun.isim);
    if (index != -1) {
      setState(() {
        if (sepet[index].miktar > 1) {
          sepet[index].miktar--;
        } else {
          sepet.removeAt(index);
        }
      });
      hesaplaToplamTutar();
      // Sepet tamamen boşaldıysa zamanlayıcıyı iptal et, yoksa sıfırla
      if (sepet.isEmpty) {
        _cancelCartTimer();
      } else {
        _resetCartTimer();
      }
    }
  }

  int getSepetMiktari(Urun urun) {
    int index = sepet.indexWhere((item) => item.urun.isim == urun.isim);
    if (index != -1) {
      return sepet[index].miktar;
    }
    return 0;
  }

  void sepetiTemizle() {
    setState(() {
      sepet.clear();
    });
    hesaplaToplamTutar();
    _cancelCartTimer(); // Manuel temizlemede zamanlayıcıyı durdur
  }

  // Bakiye sorgula butonu
  void _bakiyeSorgulaBaslat() {
    print("🟢 Bakiye sorgula penceresi açılıyor...");
    _kartOkuyucuController.clear();
    _bakiyeDialogAcik = true; // Flag set et

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        // Dialog açılır açılmaz focus'u kart okuyucuya ver
        WidgetsBinding.instance.addPostFrameCallback((_) {
          print("🎯 Bakiye sorgula - Focus veriliyor...");
          _focusNode.requestFocus();
        });

        return WillPopScope(
          onWillPop: () async => false,
          child: AlertDialog(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Text(
              "Bakiye Sorgula",
              style:
                  TextStyle(color: Colors.green, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.credit_card, size: 100, color: Colors.green),
                  SizedBox(height: 30),
                  Text(
                    "Lütfen kartınızı okutun...",
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 10),
                  Text(
                    "Kartınızı kart okuyucuya yaklaştırın",
                    style: TextStyle(fontSize: 16, color: Colors.grey[600]),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 10),
                  // DEBUG: Okunan değeri göster
                  ValueListenableBuilder(
                    valueListenable: _kartOkuyucuController,
                    builder: (context, TextEditingValue value, __) {
                      return Column(
                        children: [
                          Text("Okunan: '${value.text}'",
                              style: TextStyle(
                                  fontSize: 16,
                                  color: Colors.red,
                                  fontWeight: FontWeight.bold)),
                          Text(
                            "Uzunluk: ${value.text.length}",
                            style: TextStyle(fontSize: 12, color: Colors.grey),
                          ),
                        ],
                      );
                    },
                  ),
                  SizedBox(height: 30),
                  // Gizli TextField - sadece kart okuyucu için
                  TextField(
                    controller: _kartOkuyucuController,
                    focusNode: _focusNode,
                    autofocus: true,
                    style: TextStyle(color: Colors.transparent),
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      counterText: '',
                    ),
                    maxLength: 50,
                    onChanged: (kartID) {
                      // Kart okuyucu ENTER basmıyor, onChanged kullan
                      print(
                          "🟢 Bakiye sorgula - Kart değişti: $kartID (Uzunluk: ${kartID.length})");
                      if (kartID.trim().length >= 10) {
                        // Yeterli karakter okundu, işlem yap
                        Navigator.pop(dialogContext); // Dialog'u kapat

                        String temizKartID = '';
                        for (int i = 0; i < kartID.trim().length; i++) {
                          if (i == 0 ||
                              kartID.trim()[i] != kartID.trim()[i - 1]) {
                            temizKartID += kartID.trim()[i];
                          }
                        }
                        print("🧹 Temizlenmiş ID: $temizKartID");

                        final veriYoneticisi = VeriYoneticisi();
                        final ogrenci = veriYoneticisi.ogrenciBul(temizKartID);

                        if (ogrenci != null) {
                          print(
                              "✅ Öğrenci bulundu: ${ogrenci.adSoyad}, Bakiye: ${ogrenci.bakiye}");
                          showDialog(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: Text("Bakiye Bilgisi",
                                  style: TextStyle(color: Colors.green)),
                              content: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(ogrenci.adSoyad,
                                      style: TextStyle(
                                          fontSize: 20,
                                          fontWeight: FontWeight.bold)),
                                  SizedBox(height: 8),
                                  Text(ogrenci.sinif,
                                      style: TextStyle(
                                          fontSize: 16, color: Colors.grey)),
                                  SizedBox(height: 20),
                                  Text("Mevcut Bakiye:",
                                      style: TextStyle(
                                          fontSize: 16, color: Colors.grey)),
                                  Text(
                                      "${ogrenci.bakiye.toStringAsFixed(2)} TL",
                                      style: TextStyle(
                                          fontSize: 32,
                                          fontWeight: FontWeight.bold,
                                          color: Colors.green)),
                                ],
                              ),
                              actions: [
                                TextButton(
                                  child: Text("Tamam",
                                      style: TextStyle(fontSize: 18)),
                                  onPressed: () {
                                    Navigator.pop(context);
                                    _focusNode.requestFocus();
                                  },
                                ),
                              ],
                            ),
                          );
                        } else {
                          print("❌ Öğrenci bulunamadı: $temizKartID");
                          showDialog(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: Text("Tanımsız Kart",
                                  style: TextStyle(color: Colors.red)),
                              content: Text(
                                  "Bu kart sisteme kayıtlı değil.\nKart ID: $temizKartID"),
                              actions: [
                                TextButton(
                                  child: Text("Tamam",
                                      style: TextStyle(fontSize: 18)),
                                  onPressed: () {
                                    Navigator.pop(context);
                                    _focusNode.requestFocus();
                                  },
                                ),
                              ],
                            ),
                          );
                        }

                        _kartOkuyucuController.clear();
                      }
                    },
                    onSubmitted: (kartID) {
                      print("🟢 Bakiye sorgula - Kart okundu (ENTER): $kartID");
                      if (kartID.isNotEmpty) {
                        Navigator.pop(dialogContext); // Dialog'u kapat

                        // Kart ID'sini temizle
                        String temizKartID = '';
                        for (int i = 0; i < kartID.length; i++) {
                          if (i == 0 || kartID[i] != kartID[i - 1]) {
                            temizKartID += kartID[i];
                          }
                        }
                        print("🧹 Temizlenmiş ID: $temizKartID");

                        // Öğrenciyi bul ve bakiyeyi göster
                        final veriYoneticisi = VeriYoneticisi();
                        final ogrenci = veriYoneticisi.ogrenciBul(temizKartID);

                        if (ogrenci != null) {
                          print(
                              "✅ Öğrenci bulundu: ${ogrenci.adSoyad}, Bakiye: ${ogrenci.bakiye}");
                          showDialog(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: Text(
                                "Öğrenci Bilgileri",
                                style: TextStyle(
                                    color: Colors.indigo,
                                    fontWeight: FontWeight.bold),
                                textAlign: TextAlign.center,
                              ),
                              content: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  CircleAvatar(
                                    radius: 50,
                                    backgroundColor: Colors.indigo,
                                    child: Text(
                                      ogrenci.adSoyad[0],
                                      style: TextStyle(
                                          fontSize: 40, color: Colors.white),
                                    ),
                                  ),
                                  SizedBox(height: 20),
                                  Text(
                                    ogrenci.adSoyad,
                                    style: TextStyle(
                                        fontSize: 24,
                                        fontWeight: FontWeight.bold),
                                    textAlign: TextAlign.center,
                                  ),
                                  SizedBox(height: 10),
                                  Text(
                                    ogrenci.sinif,
                                    style: TextStyle(
                                        fontSize: 18, color: Colors.grey[600]),
                                  ),
                                  SizedBox(height: 20),
                                  Container(
                                    padding: EdgeInsets.all(16),
                                    decoration: BoxDecoration(
                                      color: Colors.green.shade50,
                                      borderRadius: BorderRadius.circular(10),
                                    ),
                                    child: Column(
                                      children: [
                                        Text(
                                          'Mevcut Bakiye',
                                          style: TextStyle(
                                              fontSize: 14,
                                              color: Colors.grey[600]),
                                        ),
                                        SizedBox(height: 5),
                                        Text(
                                          '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                                          style: TextStyle(
                                            fontSize: 36,
                                            fontWeight: FontWeight.bold,
                                            color: Colors.green,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                              actions: [
                                TextButton(
                                  child: Text("Tamam",
                                      style: TextStyle(fontSize: 16)),
                                  onPressed: () {
                                    Navigator.pop(context);
                                    _focusNode.requestFocus();
                                  },
                                ),
                              ],
                            ),
                          );
                        } else {
                          print("❌ Tanımsız kart: $temizKartID");
                          showDialog(
                            context: context,
                            builder: (context) => AlertDialog(
                              title: Text(
                                "Tanımsız Kart",
                                style: TextStyle(color: Colors.red),
                              ),
                              content: Text(
                                "Bu kart sisteme kayıtlı değil.\n\nKart ID: $temizKartID",
                                textAlign: TextAlign.center,
                              ),
                              actions: [
                                TextButton(
                                  child: Text("Tamam"),
                                  onPressed: () {
                                    Navigator.pop(context);
                                    _focusNode.requestFocus();
                                  },
                                ),
                              ],
                            ),
                          );
                        }
                      }
                      _kartOkuyucuController.clear();
                    },
                  ),
                  SizedBox(
                    width: 40,
                    height: 40,
                    child: CircularProgressIndicator(
                      color: Colors.green,
                      strokeWidth: 4,
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                child: Text("İptal", style: TextStyle(fontSize: 18)),
                onPressed: () {
                  _bakiyeDialogAcik = false;
                  Navigator.pop(dialogContext);
                  _focusNode.requestFocus();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  // Kart okutulduğunda çağrılır
  void _kartOkutuldu(String kartID) {
    print("✅ Kart okutuldu (ham): $kartID");

    // Kart numarasında gerçek ardışık rakamlar bulunabilir; karakter
    // silmek başka bir hesaba tahsilat riski doğurur. Yalnızca boşlukları temizle.
    final temizKartID = kartID.trim();

    final veriYoneticisi = VeriYoneticisi();

    // DEBUG: Tüm öğrenci ID'lerini yazdır
    print(
        "📋 Sistemdeki öğrenci ID'leri: ${veriYoneticisi.ogrenciler.keys.toList()}");
    print("🔍 Aranan ID: '$temizKartID' (${temizKartID.length} karakter)");

    // Her bir ID ile karşılaştır
    veriYoneticisi.ogrenciler.forEach((key, value) {
      print(
          "   🔸 Firebase ID: '$key' (${key.length} karakter) - Eşit mi? ${key == temizKartID}");
    });

    // Açık dialogları kapat (maksimum 5 deneme)
    int popCount = 0;
    while (Navigator.canPop(context) && popCount < 5) {
      print("🔙 Dialog kapatılıyor... ($popCount)");
      Navigator.pop(context);
      popCount++;
    }

    // Dialog kapanması için kısa bekleme
    Future.delayed(Duration(milliseconds: 150), () {
      if (!mounted) return;

      final ogrenci = veriYoneticisi.ogrenciBul(temizKartID);

      if (ogrenci != null) {
        // Eğer sepette ürün varsa ödeme işlemini başlat
        if (toplamTutar > 0) {
          print("💰 Sepet dolu, ödeme başlatılıyor...");
          _kartIsleminiYap(temizKartID);
        } else {
          // Sepet boşsa sadece öğrenci bilgilerini göster
          print("ℹ️ Sepet boş, bakiye gösteriliyor...");
          showDialog(
            context: context,
            builder: (context) => AlertDialog(
              title: Text(
                "Öğrenci Bilgileri",
                style: TextStyle(
                    color: Colors.indigo, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircleAvatar(
                    radius: 50,
                    backgroundColor: Colors.indigo,
                    child: Text(
                      ogrenci.adSoyad[0],
                      style: TextStyle(fontSize: 40, color: Colors.white),
                    ),
                  ),
                  SizedBox(height: 20),
                  Text(
                    ogrenci.adSoyad,
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 10),
                  Text(
                    ogrenci.sinif,
                    style: TextStyle(fontSize: 18, color: Colors.grey[600]),
                  ),
                  SizedBox(height: 20),
                  Container(
                    padding: EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.green.shade50,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Column(
                      children: [
                        Text(
                          'Mevcut Bakiye',
                          style:
                              TextStyle(fontSize: 14, color: Colors.grey[600]),
                        ),
                        SizedBox(height: 5),
                        Text(
                          '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                          style: TextStyle(
                            fontSize: 36,
                            fontWeight: FontWeight.bold,
                            color: Colors.green,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              actions: [
                TextButton(
                  child: Text("Tamam", style: TextStyle(fontSize: 16)),
                  onPressed: () {
                    Navigator.pop(context);
                    _focusNode.requestFocus();
                  },
                ),
              ],
            ),
          );
        }
      } else {
        // Tanımsız kart
        print("❌ Tanımsız kart: $temizKartID (ham: $kartID)");
        showDialog(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(
              "Tanımsız Kart",
              style: TextStyle(color: Colors.red),
            ),
            content: Text(
              "Bu kart sisteme kayıtlı değil.\n\nKart ID: $temizKartID",
              textAlign: TextAlign.center,
            ),
            actions: [
              TextButton(
                child: Text("Tamam"),
                onPressed: () {
                  Navigator.pop(context);
                  _focusNode.requestFocus();
                },
              ),
            ],
          ),
        );
      }
    });
  }

  // --- ÖDEME SİSTEMİ (YENİ - KLAVYE MODU) ---

  // Sepet özetini göster
  void _odemePenceresiniAc() {
    if (sepet.isEmpty) return;

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        return WillPopScope(
          onWillPop: () async => false,
          child: AlertDialog(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Row(
              children: [
                Icon(Icons.shopping_cart, color: Colors.indigo, size: 30),
                SizedBox(width: 10),
                Text(
                  "Sepet Özeti",
                  style: TextStyle(
                      color: Colors.indigo, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            content: Container(
              width: 500,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  // Sepetteki ürünler
                  Container(
                    constraints: BoxConstraints(maxHeight: 400),
                    child: ListView.builder(
                      shrinkWrap: true,
                      itemCount: sepet.length,
                      itemBuilder: (context, index) {
                        final sepetOgesi = sepet[index];
                        final toplamFiyat =
                            sepetOgesi.urun.fiyat * sepetOgesi.miktar;
                        return Card(
                          margin: EdgeInsets.symmetric(vertical: 4),
                          child: ListTile(
                            leading: Container(
                              width: 50,
                              height: 50,
                              child: sepetOgesi.urun.resimYolu
                                      .startsWith('http')
                                  ? CachedNetworkImage(
                                      imageUrl: sepetOgesi.urun.resimYolu,
                                      fit: BoxFit.contain,
                                      placeholder: (context, url) => Center(
                                          child: SizedBox(
                                              width: 20,
                                              height: 20,
                                              child: CircularProgressIndicator(
                                                  strokeWidth: 2))),
                                      errorWidget: (context, url, error) =>
                                          Icon(Icons.image_not_supported,
                                              color: Colors.grey),
                                    )
                                  : Image.asset(
                                      sepetOgesi.urun.resimYolu.isNotEmpty
                                          ? sepetOgesi.urun.resimYolu
                                          : 'assets/images/beypazarı.png',
                                      fit: BoxFit.contain,
                                      errorBuilder:
                                          (context, error, stackTrace) => Icon(
                                              Icons.image_not_supported,
                                              color: Colors.grey),
                                    ),
                            ),
                            title: Text(
                              sepetOgesi.urun.isim,
                              style: TextStyle(fontWeight: FontWeight.bold),
                            ),
                            subtitle: Text(
                              '${sepetOgesi.urun.fiyat.toStringAsFixed(2)} TL x ${sepetOgesi.miktar}',
                            ),
                            trailing: Text(
                              '${toplamFiyat.toStringAsFixed(2)} TL',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold,
                                color: Colors.indigo,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
                  ),
                  Divider(thickness: 2),
                  // Toplam tutar
                  Padding(
                    padding: EdgeInsets.symmetric(vertical: 10),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'TOPLAM:',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                        Text(
                          '${toplamTutar.toStringAsFixed(2)} TL',
                          style: TextStyle(
                            fontSize: 28,
                            fontWeight: FontWeight.bold,
                            color: Colors.indigo,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                child: Text("İptal", style: TextStyle(fontSize: 16)),
                onPressed: () => Navigator.pop(dialogContext),
              ),
              ElevatedButton.icon(
                icon: Icon(Icons.credit_card, color: Colors.white, size: 24),
                label: Text(
                  "ÖDEME YAP",
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                onPressed: () {
                  Navigator.pop(dialogContext);
                  _kartOkutmaPenceresiniAc();
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo,
                  foregroundColor: Colors.white,
                  padding: EdgeInsets.symmetric(horizontal: 30, vertical: 15),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  // Kart okutma ekranı
  void _kartOkutmaPenceresiniAc() {
    if (_odemeIsleniyor || sepet.isEmpty) return;
    print("🔵 Kart okutma penceresi açılıyor...");
    _kartOkuyucuController.clear();
    _odemeDialogAcik = true; // Flag set et

    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (BuildContext dialogContext) {
        // Dialog açılır açılmaz odaklan
        WidgetsBinding.instance.addPostFrameCallback((_) {
          print("🎯 Focus veriliyor...");
          _focusNode.requestFocus();
        });

        return WillPopScope(
          onWillPop: () async => false,
          child: AlertDialog(
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
            title: Text(
              "Kart Okutun",
              style:
                  TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold),
              textAlign: TextAlign.center,
            ),
            content: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.credit_card, size: 100, color: Colors.indigo),
                  SizedBox(height: 30),
                  Text(
                    "Lütfen kartınızı okutun...",
                    style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 10),
                  Text(
                    "Kartınızı kart okuyucuya yaklaştırın",
                    style: TextStyle(fontSize: 16, color: Colors.grey[600]),
                    textAlign: TextAlign.center,
                  ),
                  SizedBox(height: 20),
                  Text(
                    "Ödenecek Tutar:",
                    style: TextStyle(fontSize: 16, color: Colors.grey[600]),
                  ),
                  Text(
                    "${toplamTutar.toStringAsFixed(2)} TL",
                    style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: Colors.indigo),
                  ),
                  SizedBox(height: 30),
                  // Gizli TextField - sadece kart okuyucu için
                  TextField(
                    controller: _kartOkuyucuController,
                    focusNode: _focusNode,
                    autofocus: true,
                    style: TextStyle(color: Colors.transparent),
                    decoration: InputDecoration(
                      border: InputBorder.none,
                      counterText: '',
                    ),
                    maxLength: 50,
                  ),
                  SizedBox(
                    width: 40,
                    height: 40,
                    child: CircularProgressIndicator(
                      color: Colors.indigo,
                      strokeWidth: 4,
                    ),
                  ),
                ],
              ),
            ),
            actions: [
              TextButton(
                child: Text("İptal", style: TextStyle(fontSize: 18)),
                onPressed: () {
                  _odemeDialogAcik = false;
                  Navigator.pop(dialogContext);
                  _focusNode.requestFocus();
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _kartIsleminiYap(String kartID) async {
    if (_odemeIsleniyor) {
      print('⚠️ Devam eden ödeme var; ikinci kart olayı reddedildi.');
      return;
    }
    _odemeIsleniyor = true;
    print("💳 _kartIsleminiYap çağrıldı: $kartID");
    try {
      final temizKartID = kartID.trim();
      final veriYoneticisi = VeriYoneticisi();
      final ogrenci = veriYoneticisi.ogrenciBul(temizKartID);
      if (ogrenci == null) {
        if (mounted) {
          await _sonucGoster(
              'Tanımsız Kart',
              'Bu kart sisteme kayıtlı değil.\nKart ID: $temizKartID',
              false,
              false);
        }
        return;
      }

      final sepetAnlik = sepet
          .map((item) => SepetItem(urun: item.urun, miktar: item.miktar))
          .toList(growable: false);
      if (sepetAnlik.isEmpty) {
        await _sonucGoster(
          'Bakiye Bilgisi',
          '${ogrenci.adSoyad}\n${ogrenci.sinif}\n\nMevcut Bakiye: ${ogrenci.bakiye.toStringAsFixed(2)} TL',
          true,
          false,
        );
        return;
      }

      final satisId = 'pos_${const Uuid().v4()}';
      String? fotoYolu;
      String? yerelFotoYolu;
      if (globalCameraController != null &&
          globalCameraController!.value.isInitialized) {
        try {
          final XFile image = await globalCameraController!.takePicture();
          yerelFotoYolu = image.path;
          fotoYolu = 'islem_fotograflari/$temizKartID/$satisId.jpg';
          _fotografiArkaplandaYukle(image, fotoYolu);
        } catch (e) {
          print('⚠️ Fotoğraf çekilemedi: $e');
        }
      }

      late final OdemeSonucu sonuc;
      try {
        sonuc = await veriYoneticisi.odemeYap(
          temizKartID,
          sepetAnlik,
          satisId: satisId,
          islemFotografiYolu: fotoYolu,
        );
      } on OdemeHatasi catch (e) {
        if (!e.tekrarDenenebilir) rethrow;
        sonuc = await veriYoneticisi.cevrimdisiOdemeKaydet(
          temizKartID,
          sepetAnlik,
          satisId: satisId,
          islemFotografiYolu: fotoYolu,
          yerelFotografYolu: yerelFotoYolu,
        );
      }
      if (!mounted) return;

      // Transaction onaylandığı anda sepeti kapat; sonuç penceresini
      // beklerken aynı sepetin başka karta satılmasına izin verme.
      _cancelCartTimer();
      setState(() {
        sepet.clear();
        toplamTutar = 0;
        secilenKategori = null;
      });
      await _sonucGoster(
        sonuc.cevrimdisi
            ? 'Çevrimdışı Satış Kaydedildi'
            : (sonuc.dahaOnceIslendi
                ? 'Ödeme Zaten Kayıtlı'
                : 'Ödeme Başarılı!'),
        '${ogrenci.adSoyad}\nÖdenen: ${sonuc.toplamTutar.toStringAsFixed(2)} TL'
        '\nKalan Bakiye: ${sonuc.yeniBakiye.toStringAsFixed(2)} TL'
        '${sonuc.cevrimdisi ? '\n\nİnternet gelince otomatik senkronize edilecek.' : ''}',
        true,
        false,
      );
    } on OdemeHatasi catch (e) {
      if (mounted) {
        await _sonucGoster('Ödeme Yapılmadı', e.mesaj, false, false);
      }
    } catch (e) {
      print('❌ Beklenmeyen ödeme hatası: $e');
      if (mounted) {
        await _sonucGoster(
          'Ödeme Yapılmadı',
          'Sunucu onayı alınamadı. Bakiye ve stok değiştirilmedi.',
          false,
          false,
        );
      }
    } finally {
      _odemeIsleniyor = false;
      if (mounted) _focusNode.requestFocus();
    }
  }

  void _fotografiArkaplandaYukle(XFile image, String path) async {
    try {
      final ref = FirebaseStorage.instance.ref().child(path);
      await ref.putFile(File(image.path));
      print("✅ Fotoğraf arka planda yüklendi: $path");

      // İsterseniz dosyayı silebilirsiniz:
      // File(image.path).delete();
    } catch (e) {
      print("⚠️ Arka planda fotoğraf yüklenemedi: $e");
    }
  }

  Future<void> _sonucGoster(
      String baslik, String mesaj, bool basarili, bool refreshYap) async {
    await showDialog<void>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(baslik,
            style: TextStyle(color: basarili ? Colors.green : Colors.red)),
        content: Text(mesaj, textAlign: TextAlign.center),
        actions: [
          TextButton(
              child: Text("Tamam", style: TextStyle(fontSize: 18)),
              onPressed: () {
                Navigator.of(dialogContext).pop();
              })
        ],
      ),
    );

    if (!mounted) return;
    if (refreshYap) {
      _cancelCartTimer();
      setState(() {
        sepet.clear();
        toplamTutar = 0.0;
        secilenKategori = null;
      });
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _focusNode.requestFocus();
    });
  }

  // Bakiye sorgulama işlemi
  void _bakiyeSorgula(String kartID) {
    print("💰 _bakiyeSorgula çağrıldı: $kartID");

    // Kart ID'sini temizle
    String temizKartID = '';
    for (int i = 0; i < kartID.length; i++) {
      if (i == 0 || kartID[i] != kartID[i - 1]) {
        temizKartID += kartID[i];
      }
    }
    print("🧹 Temizlenmiş ID: $temizKartID");

    // Öğrenciyi bul
    final veriYoneticisi = VeriYoneticisi();
    final ogrenci = veriYoneticisi.ogrenciBul(temizKartID);

    if (ogrenci != null) {
      print("✅ Öğrenci bulundu: ${ogrenci.adSoyad}, Bakiye: ${ogrenci.bakiye}");
      showDialog(
        context: context,
        builder: (context) => AlertDialog(
          title: Text("Bakiye Bilgisi", style: TextStyle(color: Colors.green)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircleAvatar(
                radius: 50,
                backgroundColor: Colors.green,
                child: Text(
                  ogrenci.adSoyad[0],
                  style: TextStyle(fontSize: 40, color: Colors.white),
                ),
              ),
              SizedBox(height: 20),
              Text(ogrenci.adSoyad,
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              SizedBox(height: 8),
              Text(ogrenci.sinif,
                  style: TextStyle(fontSize: 16, color: Colors.grey)),
              SizedBox(height: 20),
              Container(
                padding: EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.green.shade50,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Column(
                  children: [
                    Text("Mevcut Bakiye",
                        style: TextStyle(fontSize: 16, color: Colors.grey)),
                    SizedBox(height: 8),
                    Text("${ogrenci.bakiye.toStringAsFixed(2)} TL",
                        style: TextStyle(
                            fontSize: 32,
                            fontWeight: FontWeight.bold,
                            color: Colors.green)),
                  ],
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              child: Text("Tamam", style: TextStyle(fontSize: 18)),
              onPressed: () {
                Navigator.pop(context);
                _focusNode.requestFocus();
              },
            ),
          ],
        ),
      );
    } else {
      print("❌ Öğrenci bulunamadı: $temizKartID");
      showDialog(
        context: context,
        builder: (context) => AlertDialog(
          title: Text("Tanımsız Kart", style: TextStyle(color: Colors.red)),
          content:
              Text("Bu kart sisteme kayıtlı değil.\nKart ID: $temizKartID"),
          actions: [
            TextButton(
              child: Text("Tamam", style: TextStyle(fontSize: 18)),
              onPressed: () {
                Navigator.pop(context);
                _focusNode.requestFocus();
              },
            ),
          ],
        ),
      );
    }
  }

  // Admin giriş
  void _adminGiris() {
    final sifreController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Admin Girişi'),
        content: TextField(
          controller: sifreController,
          obscureText: true,
          decoration: InputDecoration(
            labelText: 'Şifre',
            hintText: 'Admin şifresini girin',
          ),
          onSubmitted: (_) {
            if (sifreController.text == VeriYoneticisi().adminSifresi) {
              Navigator.pop(context);
              Navigator.pushNamed(context, '/admin');
            } else {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                    content: Text('Hatalı şifre!'),
                    backgroundColor: Colors.red),
              );
            }
          },
        ),
        actions: [
          TextButton(
            child: Text('İptal'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            child: Text('Giriş'),
            onPressed: () {
              if (sifreController.text == VeriYoneticisi().adminSifresi) {
                Navigator.pop(context);
                Navigator.pushNamed(context, '/admin');
              } else {
                Navigator.pop(context);
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                      content: Text('Hatalı şifre!'),
                      backgroundColor: Colors.red),
                );
              }
            },
          ),
        ],
      ),
    );
  }

  // Kategori Grid
  Widget _kategoriGrid() {
    return GridView.builder(
      padding: EdgeInsets.all(20.0),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4, // Yatay ekranda 4 kategori yan yana
        crossAxisSpacing: 20.0,
        mainAxisSpacing: 20.0,
        childAspectRatio: 1.3, // Yatay ekran için oran
      ),
      itemCount: kategoriler.length,
      itemBuilder: (context, index) {
        final kategori = kategoriler[index];
        return InkWell(
          onTap: () {
            setState(() {
              secilenKategori = kategori.isim;
            });
          },
          child: Card(
            elevation: 4,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(15),
            ),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(15),
                gradient: LinearGradient(
                  colors: [kategori.renk.withOpacity(0.7), kategori.renk],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  // Kategori ikonu (resim kaldırıldı)
                  Icon(
                    kategori.icon,
                    size: 80,
                    color: Colors.white,
                  ),
                  SizedBox(height: 15),
                  Text(
                    kategori.isim,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // Ürün Grid (Seçili kategoriye göre)
  Widget _urunGrid() {
    final filtreliUrunler =
        urunler.where((urun) => urun.kategori == secilenKategori).toList();

    if (filtreliUrunler.isEmpty) {
      return Center(
        child: Text(
          'Bu kategoride henüz ürün yok',
          style: TextStyle(fontSize: 18, color: Colors.grey),
        ),
      );
    }

    return GridView.builder(
      padding: EdgeInsets.all(16.0),
      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4, // Yatay ekranda 4 ürün yan yana
        crossAxisSpacing: 16.0,
        mainAxisSpacing: 16.0,
        childAspectRatio: 0.75, // Yatay ekran için oran
      ),
      itemCount: filtreliUrunler.length,
      itemBuilder: (context, index) {
        final urun = filtreliUrunler[index];
        final miktar = getSepetMiktari(urun);
        return UrunKarti(
          urun: urun,
          miktar: miktar,
          onEkle: () => sepeteEkle(urun),
          onCikar: () => sepettenCikar(urun),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return WillPopScope(
      // Tablet geri tuşunu engelle - öğrenciler uygulamadan çıkmasın
      // TEST İÇİN GEÇİCİ AÇIK
      onWillPop: () async => true,
      child: Scaffold(
        backgroundColor: Colors.grey[100],
        appBar: AppBar(
          toolbarHeight: 80, // AppBar yüksekliğini artır
          automaticallyImplyLeading: false, // Sol ok tuşunu kaldır
          title: Text(secilenKategori ?? 'Okul Otomat',
              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
          actions: [
            // Status Indicator & Refresh
            Center(
              // Center to align vertically in AppBar
              child: Padding(
                padding: const EdgeInsets.only(right: 8.0),
                child: Container(
                  padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(
                    color: Colors.black26,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 10,
                        height: 10,
                        decoration: BoxDecoration(
                          color: _statusRenk,
                          shape: BoxShape.circle,
                        ),
                      ),
                      SizedBox(width: 8),
                      Text(_statusMesaji,
                          style: TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.bold)),
                      SizedBox(width: 8),
                      InkWell(
                        onTap: () {
                          print("🔄 Kullanıcı verileri yeniliyor...");
                          _verileriYenile();
                        },
                        child:
                            Icon(Icons.refresh, size: 18, color: Colors.white),
                      ),
                    ],
                  ),
                ),
              ),
            ),

            // BÜYÜK GERİ DÖN butonu (sadece kategori seçiliyse)
            if (secilenKategori != null)
              Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                child: ElevatedButton(
                  onPressed: () {
                    setState(() {
                      secilenKategori = null;
                    });
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: Colors.indigo,
                    padding: EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.arrow_back, size: 28),
                      SizedBox(width: 8),
                      Text(
                        'GERİ DÖN',
                        style: TextStyle(
                            fontSize: 22, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ),
          ],
          flexibleSpace: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                  colors: [Colors.indigo, Colors.indigo.shade700]),
            ),
          ),
        ),
        body: Stack(
          children: [
            Column(
              children: [
                Expanded(
                  child: !_verilerYuklendi
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              CircularProgressIndicator(
                                  color: Colors.indigo, strokeWidth: 5),
                              SizedBox(height: 16),
                              Text("Ürünler Yükleniyor...",
                                  style: TextStyle(
                                      color: Colors.indigo,
                                      fontSize: 18,
                                      fontWeight: FontWeight.bold)),
                            ],
                          ),
                        )
                      : AnimatedBuilder(
                          animation: VeriYoneticisi(),
                          builder: (context, child) {
                            return secilenKategori == null
                                ? _kategoriGrid()
                                : _urunGrid();
                          },
                        ),
                ),
                Container(
                  padding:
                      EdgeInsets.symmetric(vertical: 15.0, horizontal: 20.0),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius:
                        BorderRadius.vertical(top: Radius.circular(20)),
                    boxShadow: [
                      BoxShadow(color: Colors.black12, blurRadius: 10)
                    ],
                  ),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('TOPLAM:',
                              style: TextStyle(
                                  fontSize: 18, fontWeight: FontWeight.bold)),
                          Text('${toplamTutar.toStringAsFixed(2)} TL',
                              style: TextStyle(
                                  fontSize: 26,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.indigo)),
                        ],
                      ),
                      SizedBox(height: 15),
                      Row(
                        children: [
                          Expanded(
                            flex: 2,
                            child: OutlinedButton.icon(
                              onPressed: sepetiTemizle,
                              icon: Icon(Icons.delete_outline),
                              label: Text('Temizle'),
                              style: OutlinedButton.styleFrom(
                                  minimumSize: Size(0, 50)),
                            ),
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            flex: 3,
                            child: ElevatedButton.icon(
                              icon: Icon(Icons.account_balance_wallet,
                                  color: Colors.white),
                              label: Text(
                                'BAKİYE SORGULA',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold),
                              ),
                              onPressed: _bakiyeSorgulaBaslat,
                              style: ElevatedButton.styleFrom(
                                minimumSize: Size(0, 50),
                                backgroundColor: Colors.green,
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ),
                          SizedBox(width: 10),
                          Expanded(
                            flex: 3,
                            child: ElevatedButton.icon(
                              icon:
                                  Icon(Icons.credit_card, color: Colors.white),
                              label: Text(
                                'KART İLE ÖDE',
                                style: TextStyle(
                                    color: Colors.white,
                                    fontWeight: FontWeight.bold),
                              ),
                              onPressed: (toplamTutar > 0)
                                  ? _odemePenceresiniAc
                                  : null,
                              style: ElevatedButton.styleFrom(
                                minimumSize: Size(0, 50),
                                backgroundColor: Colors.indigo,
                                foregroundColor: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      )
                    ],
                  ),
                ),
              ],
            ),
            // GİZLİ KART OKUYUCU - Ekranın dışında ama aktif
            Positioned(
              left: -1000,
              top: -1000,
              child: Container(
                width: 1,
                height: 1,
                child: TextField(
                  controller: _kartOkuyucuController,
                  focusNode: _focusNode,
                  keyboardType: TextInputType.none, // Klavye açılmasın
                  // keyboardType: TextInputType.visiblePassword,
                  autocorrect: false,
                  enableSuggestions: false,
                  autofocus: true,
                  showCursor: true, // Cursor görünsün ki odak var mı anlayalım
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    hintText: "Buraya Odaklan", // Debug için
                    hintStyle: TextStyle(color: Colors.transparent),
                  ),
                  onChanged: (val) {
                    print("📝 TextField onChanged: $val");
                  },
                  onSubmitted: (val) {
                    print("📩 TextField onSubmitted: $val");
                    if (val.isNotEmpty) {
                      _kartOkutuldu(val);
                      _kartOkuyucuController.clear();
                      // Focus'u koru
                      Future.delayed(Duration(milliseconds: 100), () {
                        _focusNode.requestFocus();
                      });
                    }
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// UrunKarti Widget'ı
class UrunKarti extends StatelessWidget {
  final Urun urun;
  final int miktar;
  final VoidCallback onEkle;
  final VoidCallback onCikar;

  const UrunKarti({
    Key? key,
    required this.urun,
    required this.miktar,
    required this.onEkle,
    required this.onCikar,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    final bool stokTukendi = urun.stok <= 0;

    return Card(
      elevation: stokTukendi ? 1.0 : 3.0,
      shadowColor: Colors.indigo.withOpacity(0.2),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(15.0),
      ),
      child: Stack(
        children: [
          // Ana kart içeriği
          Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(15.0),
              gradient: LinearGradient(
                colors: stokTukendi
                    ? [Colors.grey.shade200, Colors.grey.shade100]
                    : [
                        Colors.white,
                        Colors.indigo.shade50.withOpacity(0.5),
                      ],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Padding(
              padding: const EdgeInsets.all(10.0),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Ürün Görseli
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.all(8.0),
                      child: Opacity(
                        opacity: stokTukendi ? 0.4 : 1.0,
                        child: urun.resimYolu.startsWith('http')
                            ? CachedNetworkImage(
                                imageUrl: urun.resimYolu,
                                fit: BoxFit.contain,
                                placeholder: (context, url) => Center(
                                    child: CircularProgressIndicator(
                                        color: Colors.indigo)),
                                errorWidget: (context, url, error) => Icon(
                                  Icons.image_not_supported,
                                  size: 60,
                                  color: Colors.grey[300],
                                ),
                              )
                            : Image.asset(
                                urun.resimYolu.isNotEmpty
                                    ? urun.resimYolu
                                    : 'assets/images/beypazarı.png',
                                fit: BoxFit.contain,
                                errorBuilder: (context, error, stackTrace) {
                                  return Icon(
                                    Icons.image_not_supported,
                                    size: 60,
                                    color: Colors.grey[300],
                                  );
                                },
                              ),
                      ),
                    ),
                  ),
                  SizedBox(height: 10),
                  // Ürün Adı
                  Text(
                    urun.isim,
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: stokTukendi ? Colors.grey : Colors.black87,
                    ),
                    textAlign: TextAlign.center,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  // Fiyat
                  Text(
                    '${urun.fiyat.toStringAsFixed(2)} TL',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: stokTukendi ? Colors.grey : Colors.indigo,
                    ),
                  ),
                  SizedBox(height: 10),
                  // Stok durumuna göre buton
                  if (stokTukendi)
                    Container(
                      width: double.infinity,
                      padding: EdgeInsets.symmetric(vertical: 10),
                      decoration: BoxDecoration(
                        color: Colors.grey.shade300,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        'TÜKENDI',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.grey.shade600,
                          letterSpacing: 1.2,
                        ),
                      ),
                    )
                  else if (miktar == 0)
                    ElevatedButton(
                      onPressed: onEkle,
                      child: Text('Sepete Ekle'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.indigo,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                      ),
                    )
                  else
                    Container(
                      decoration: BoxDecoration(
                        color: Colors.indigo.shade50,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                        children: [
                          IconButton(
                            icon: Icon(Icons.remove, color: Colors.indigo),
                            onPressed: onCikar,
                          ),
                          Text(
                            '$miktar',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: Colors.black87,
                            ),
                          ),
                          IconButton(
                            icon: Icon(
                              Icons.add,
                              color: miktar >= urun.stok
                                  ? Colors.grey
                                  : Colors.indigo,
                            ),
                            onPressed: miktar >= urun.stok ? null : onEkle,
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          ),
          // TÜKENDI banner (sağ üst köşe)
          if (stokTukendi)
            Positioned(
              top: 8,
              right: 8,
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.red.shade400,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  'TÜKENDI',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// --- ÖĞRENCİ DETAY EKRANI (Telefon için) ---
class OgrenciDetayEkrani extends StatefulWidget {
  final Ogrenci ogrenci;

  const OgrenciDetayEkrani({Key? key, required this.ogrenci}) : super(key: key);

  @override
  State<OgrenciDetayEkrani> createState() => _OgrenciDetayEkraniState();
}

class _OgrenciDetayEkraniState extends State<OgrenciDetayEkrani> {
  final veriYoneticisi = VeriYoneticisi();

  @override
  Widget build(BuildContext context) {
    final ogrenci = veriYoneticisi.ogrenciler[widget.ogrenci.kartID]!;

    return Scaffold(
      appBar: AppBar(
        title: Text(ogrenci.adSoyad),
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient:
                LinearGradient(colors: [Colors.indigo, Colors.indigo.shade700]),
          ),
        ),
      ),
      body: Container(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Öğrenci bilgileri
            Card(
              elevation: 4,
              child: Padding(
                padding: EdgeInsets.all(16),
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 40,
                      backgroundColor: Colors.indigo,
                      child: Text(
                        ogrenci.adSoyad[0],
                        style: TextStyle(fontSize: 32, color: Colors.white),
                      ),
                    ),
                    SizedBox(height: 16),
                    Text(
                      ogrenci.adSoyad,
                      style:
                          TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                    ),
                    Text(
                      'Sınıf: ${ogrenci.sinif}',
                      style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                    ),
                    Text(
                      'Kart ID: ${ogrenci.kartID}',
                      style: TextStyle(fontSize: 12, color: Colors.grey[500]),
                    ),
                    SizedBox(height: 16),
                    Text(
                      'Bakiye',
                      style: TextStyle(fontSize: 14, color: Colors.grey[600]),
                    ),
                    Text(
                      '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                      style: TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.bold,
                        color: ogrenci.bakiye > 0 ? Colors.green : Colors.red,
                      ),
                    ),
                    SizedBox(height: 16),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        icon: Icon(Icons.add_circle),
                        label: Text('Bakiye Yükle'),
                        onPressed: () => _bakiyeYukle(ogrenci),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          padding: EdgeInsets.symmetric(vertical: 12),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            SizedBox(height: 16),
            // İşlem geçmişi
            Text(
              'İşlem Geçmişi',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            SizedBox(height: 8),
            Expanded(
              child: ogrenci.islemGecmisi.isEmpty
                  ? Center(
                      child: Text(
                        'Henüz işlem yapılmamış',
                        style: TextStyle(color: Colors.grey),
                      ),
                    )
                  : ListView.builder(
                      itemCount: ogrenci.islemGecmisi.length,
                      itemBuilder: (context, index) {
                        final islem =
                            ogrenci.islemGecmisi.reversed.toList()[index];
                        final dateFormat = DateFormat('dd/MM/yyyy HH:mm');

                        return Card(
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor:
                                  islem.tutar > 0 ? Colors.green : Colors.red,
                              child: Icon(
                                islem.tutar > 0
                                    ? Icons.arrow_downward
                                    : Icons.arrow_upward,
                                color: Colors.white,
                                size: 20,
                              ),
                            ),
                            title:
                                Text(islem.tip, style: TextStyle(fontSize: 14)),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  dateFormat.format(islem.tarih),
                                  style: TextStyle(
                                      fontSize: 11, color: Colors.grey[600]),
                                ),
                                Text(islem.aciklama,
                                    style: TextStyle(fontSize: 12)),
                                if (islem.urunler != null &&
                                    islem.urunler!.isNotEmpty)
                                  Padding(
                                    padding: EdgeInsets.only(top: 4),
                                    child: Text(
                                      'Ürünler: ${islem.urunler!.join(", ")}',
                                      style: TextStyle(
                                          fontSize: 11, color: Colors.indigo),
                                    ),
                                  ),
                              ],
                            ),
                            trailing: Text(
                              '${islem.tutar > 0 ? '+' : ''}${islem.tutar.toStringAsFixed(2)} TL',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color:
                                    islem.tutar > 0 ? Colors.green : Colors.red,
                              ),
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }

  void _bakiyeYukle(Ogrenci ogrenci) {
    final tutarController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Bakiye Yükle'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${ogrenci.adSoyad} için bakiye yükle'),
            SizedBox(height: 20),
            TextField(
              controller: tutarController,
              keyboardType: TextInputType.number,
              autofocus: true,
              decoration: InputDecoration(
                labelText: 'Tutar (TL)',
                border: OutlineInputBorder(),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            child: Text('İptal'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            child: Text('Yükle'),
            onPressed: () async {
              final tutar = double.tryParse(tutarController.text);
              if (tutar != null && tutar > 0) {
                try {
                  await veriYoneticisi.bakiyeYukle(ogrenci.kartID, tutar);
                  if (!mounted) return;
                  Navigator.pop(context);
                  setState(() {});
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('${tutar.toStringAsFixed(2)} TL yüklendi!'),
                      backgroundColor: Colors.green,
                    ),
                  );
                } on OdemeHatasi catch (e) {
                  if (!mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text(e.mesaj), backgroundColor: Colors.red),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }
}

// --- ADMİN PANELİ ---
class AdminPaneli extends StatefulWidget {
  @override
  State<AdminPaneli> createState() => _AdminPaneliState();
}

class _AdminPaneliState extends State<AdminPaneli>
    with SingleTickerProviderStateMixin {
  final veriYoneticisi = VeriYoneticisi();
  Ogrenci? secilenOgrenci;
  late TabController _tabController;
  bool _yukleniyor = true;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    veriYoneticisi.addListener(_onVeriDegisti);
    _verileriYukle();
  }

  Future<void> _verileriYukle() async {
    setState(() => _yukleniyor = true);
    await veriYoneticisi.verileriYukle();
    setState(() => _yukleniyor = false);
  }

  void _onVeriDegisti() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    veriYoneticisi.removeListener(_onVeriDegisti);
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_yukleniyor) {
      return Scaffold(
        appBar: AppBar(
          title: Text('Admin Paneli'),
          flexibleSpace: Container(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                  colors: [Colors.indigo, Colors.indigo.shade700]),
            ),
          ),
        ),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 20),
              Text('Firestore\'dan veriler yükleniyor...'),
            ],
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title:
            Text('Admin Paneli', style: TextStyle(fontWeight: FontWeight.bold)),
        bottom: TabBar(
          controller: _tabController,
          tabs: [
            Tab(icon: Icon(Icons.people), text: 'Öğrenciler'),
            Tab(icon: Icon(Icons.bar_chart), text: 'İstatistikler'),
          ],
        ),
        flexibleSpace: Container(
          decoration: BoxDecoration(
            gradient:
                LinearGradient(colors: [Colors.indigo, Colors.indigo.shade700]),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _ogrenciYonetimi(),
          _istatistikler(),
        ],
      ),
    );
  }

  Widget _ogrenciYonetimi() {
    final screenWidth = MediaQuery.of(context).size.width;
    final isTablet = screenWidth > 600;

    if (!isTablet) {
      // Telefon için - Tek sütun layout
      return Column(
        children: [
          // Öğrenci listesi üstte
          Expanded(
            child: Container(
              color: Colors.grey[200],
              child: Column(
                children: [
                  Padding(
                    padding: EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            'Öğrenciler',
                            style: TextStyle(
                                fontSize: 18, fontWeight: FontWeight.bold),
                          ),
                        ),
                        IconButton(
                          icon: Icon(Icons.person_add),
                          onPressed: _yeniOgrenciEkle,
                          tooltip: 'Yeni Öğrenci',
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ListView.builder(
                      itemCount: veriYoneticisi.ogrenciler.length,
                      itemBuilder: (context, index) {
                        final ogrenci =
                            veriYoneticisi.ogrenciler.values.toList()[index];
                        final secili = secilenOgrenci?.kartID == ogrenci.kartID;
                        return Card(
                          margin:
                              EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          color: secili ? Colors.indigo[100] : Colors.white,
                          child: ListTile(
                            leading: CircleAvatar(
                              backgroundColor: Colors.indigo,
                              child: Text(
                                ogrenci.adSoyad[0],
                                style: TextStyle(color: Colors.white),
                              ),
                            ),
                            title: Text(
                              ogrenci.adSoyad,
                              style: TextStyle(
                                  fontWeight: FontWeight.bold, fontSize: 14),
                            ),
                            subtitle: Text(
                              '${ogrenci.sinif} • ${ogrenci.kartID}',
                              style: TextStyle(fontSize: 12),
                            ),
                            trailing: Text(
                              '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.bold,
                                color: ogrenci.bakiye > 0
                                    ? Colors.green
                                    : Colors.red,
                              ),
                            ),
                            onTap: () {
                              setState(() {
                                secilenOgrenci = ogrenci;
                              });
                            },
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
          // Seçili öğrenci detayı altta
          if (secilenOgrenci != null)
            Container(
              height: 80,
              color: Colors.indigo[50],
              padding: EdgeInsets.all(8),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Colors.indigo,
                    child: Text(
                      secilenOgrenci!.adSoyad[0],
                      style: TextStyle(color: Colors.white),
                    ),
                  ),
                  SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          secilenOgrenci!.adSoyad,
                          style: TextStyle(
                              fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                        Text(
                          '${secilenOgrenci!.bakiye.toStringAsFixed(2)} TL',
                          style: TextStyle(
                            fontSize: 14,
                            color: secilenOgrenci!.bakiye > 0
                                ? Colors.green
                                : Colors.red,
                          ),
                        ),
                      ],
                    ),
                  ),
                  ElevatedButton(
                    onPressed: () => _bakiyeYukle(secilenOgrenci!),
                    child: Icon(Icons.add),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.green,
                      shape: CircleBorder(),
                      padding: EdgeInsets.all(12),
                    ),
                  ),
                  SizedBox(width: 8),
                  ElevatedButton(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (context) =>
                              OgrenciDetayEkrani(ogrenci: secilenOgrenci!),
                        ),
                      ).then((_) => setState(() {}));
                    },
                    child: Icon(Icons.arrow_forward),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.indigo,
                      shape: CircleBorder(),
                      padding: EdgeInsets.all(12),
                    ),
                  ),
                ],
              ),
            ),
        ],
      );
    }

    // Tablet için - Yan yana layout (orijinal)
    return Row(
      children: [
        // Sol taraf - Öğrenci listesi
        Expanded(
          flex: 1,
          child: Container(
            color: Colors.grey[200],
            child: Column(
              children: [
                Padding(
                  padding: EdgeInsets.all(16),
                  child: Row(
                    children: [
                      Expanded(
                        child: Text(
                          'Öğrenci Listesi',
                          style: TextStyle(
                              fontSize: 20, fontWeight: FontWeight.bold),
                        ),
                      ),
                      IconButton(
                        icon: Icon(Icons.person_add),
                        onPressed: _yeniOgrenciEkle,
                        tooltip: 'Yeni Öğrenci Ekle',
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    itemCount: veriYoneticisi.ogrenciler.length,
                    itemBuilder: (context, index) {
                      final ogrenci =
                          veriYoneticisi.ogrenciler.values.toList()[index];
                      final secili = secilenOgrenci?.kartID == ogrenci.kartID;
                      return Card(
                        margin:
                            EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        color: secili ? Colors.indigo[100] : Colors.white,
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor: Colors.indigo,
                            child: Text(
                              ogrenci.adSoyad[0],
                              style: TextStyle(color: Colors.white),
                            ),
                          ),
                          title: Text(
                            ogrenci.adSoyad,
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          subtitle: Text(
                              '${ogrenci.sinif} • Kart: ${ogrenci.kartID}'),
                          trailing: Text(
                            '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: ogrenci.bakiye > 0
                                  ? Colors.green
                                  : Colors.red,
                            ),
                          ),
                          onTap: () {
                            setState(() {
                              secilenOgrenci = ogrenci;
                            });
                          },
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
        // Sağ taraf - Öğrenci detayları
        Expanded(
          flex: 2,
          child: secilenOgrenci == null
              ? Center(
                  child: Text(
                    'Bir öğrenci seçin',
                    style: TextStyle(fontSize: 18, color: Colors.grey),
                  ),
                )
              : _ogrenciDetay(),
        ),
      ],
    );
  }

  Widget _ogrenciDetay() {
    final ogrenci = secilenOgrenci!;
    return Container(
      padding: EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Öğrenci bilgileri
          Card(
            elevation: 4,
            child: Padding(
              padding: EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 40,
                        backgroundColor: Colors.indigo,
                        child: Text(
                          ogrenci.adSoyad[0],
                          style: TextStyle(fontSize: 32, color: Colors.white),
                        ),
                      ),
                      SizedBox(width: 20),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              ogrenci.adSoyad,
                              style: TextStyle(
                                  fontSize: 24, fontWeight: FontWeight.bold),
                            ),
                            Text(
                              'Sınıf: ${ogrenci.sinif}',
                              style: TextStyle(
                                  fontSize: 16, color: Colors.grey[600]),
                            ),
                            Text(
                              'Kart ID: ${ogrenci.kartID}',
                              style: TextStyle(
                                  fontSize: 14, color: Colors.grey[500]),
                            ),
                          ],
                        ),
                      ),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          Text(
                            'Bakiye',
                            style: TextStyle(
                                fontSize: 14, color: Colors.grey[600]),
                          ),
                          Text(
                            '${ogrenci.bakiye.toStringAsFixed(2)} TL',
                            style: TextStyle(
                              fontSize: 32,
                              fontWeight: FontWeight.bold,
                              color: ogrenci.bakiye > 0
                                  ? Colors.green
                                  : Colors.red,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                  SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: ElevatedButton.icon(
                          icon: Icon(Icons.add_circle),
                          label: Text('Bakiye Yükle'),
                          onPressed: () => _bakiyeYukle(ogrenci),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: Colors.green,
                            padding: EdgeInsets.symmetric(vertical: 16),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          SizedBox(height: 20),
          // İşlem geçmişi
          Text(
            'İşlem Geçmişi',
            style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
          ),
          SizedBox(height: 10),
          Expanded(
            child: ogrenci.islemGecmisi.isEmpty
                ? Center(
                    child: Text(
                      'Henüz işlem yapılmamış',
                      style: TextStyle(color: Colors.grey),
                    ),
                  )
                : ListView.builder(
                    itemCount: ogrenci.islemGecmisi.length,
                    itemBuilder: (context, index) {
                      final islem =
                          ogrenci.islemGecmisi.reversed.toList()[index];
                      final dateFormat = DateFormat('dd/MM/yyyy HH:mm');

                      return Card(
                        child: ListTile(
                          leading: CircleAvatar(
                            backgroundColor:
                                islem.tutar > 0 ? Colors.green : Colors.red,
                            child: Icon(
                              islem.tutar > 0
                                  ? Icons.arrow_downward
                                  : Icons.arrow_upward,
                              color: Colors.white,
                            ),
                          ),
                          title: Text(islem.tip),
                          subtitle: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                dateFormat.format(islem.tarih),
                                style: TextStyle(
                                    fontSize: 12, color: Colors.grey[600]),
                              ),
                              Text(islem.aciklama),
                              if (islem.urunler != null &&
                                  islem.urunler!.isNotEmpty)
                                Padding(
                                  padding: EdgeInsets.only(top: 4),
                                  child: Text(
                                    'Ürünler: ${islem.urunler!.join(", ")}',
                                    style: TextStyle(
                                        fontSize: 12, color: Colors.indigo),
                                  ),
                                ),
                            ],
                          ),
                          trailing: Text(
                            '${islem.tutar > 0 ? '+' : ''}${islem.tutar.toStringAsFixed(2)} TL',
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color:
                                  islem.tutar > 0 ? Colors.green : Colors.red,
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }

  void _bakiyeYukle(Ogrenci ogrenci) {
    final tutarController = TextEditingController();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Bakiye Yükle'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('${ogrenci.adSoyad} için bakiye yükle'),
            SizedBox(height: 20),
            TextField(
              controller: tutarController,
              keyboardType: TextInputType.number,
              decoration: InputDecoration(
                labelText: 'Tutar (TL)',
                border: OutlineInputBorder(),
                prefixIcon: Icon(Icons.money),
              ),
              autofocus: true,
            ),
          ],
        ),
        actions: [
          TextButton(
            child: Text('İptal'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            child: Text('Yükle'),
            onPressed: () async {
              final tutar = double.tryParse(tutarController.text);
              if (tutar != null && tutar > 0) {
                try {
                  await veriYoneticisi.bakiyeYukle(ogrenci.kartID, tutar);
                  if (!mounted) return;
                  Navigator.pop(context);
                  setState(() {});
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(
                          '${tutar.toStringAsFixed(2)} TL başarıyla yüklendi!'),
                      backgroundColor: Colors.green,
                    ),
                  );
                } on OdemeHatasi catch (e) {
                  if (!mounted) return;
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                        content: Text(e.mesaj), backgroundColor: Colors.red),
                  );
                }
              }
            },
          ),
        ],
      ),
    );
  }

  void _yeniOgrenciEkle() {
    final adController = TextEditingController();
    final sinifController = TextEditingController();
    final kartController = TextEditingController();
    final bakiyeController = TextEditingController(text: '0');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Yeni Öğrenci Ekle'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: adController,
                decoration: InputDecoration(
                  labelText: 'Ad Soyad',
                  border: OutlineInputBorder(),
                ),
              ),
              SizedBox(height: 10),
              TextField(
                controller: sinifController,
                decoration: InputDecoration(
                  labelText: 'Sınıf (örn: BYF - 1)',
                  border: OutlineInputBorder(),
                ),
              ),
              SizedBox(height: 10),
              TextField(
                controller: kartController,
                decoration: InputDecoration(
                  labelText: 'Kart ID',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
              ),
              SizedBox(height: 10),
              TextField(
                controller: bakiyeController,
                decoration: InputDecoration(
                  labelText: 'Başlangıç Bakiyesi (TL)',
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.number,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
            child: Text('İptal'),
            onPressed: () => Navigator.pop(context),
          ),
          ElevatedButton(
            child: Text('Ekle'),
            onPressed: () async {
              if (adController.text.isNotEmpty &&
                  sinifController.text.isNotEmpty &&
                  kartController.text.isNotEmpty) {
                final yeniOgrenci = Ogrenci(
                  kartID: kartController.text,
                  adSoyad: adController.text,
                  sinif: sinifController.text,
                  bakiye: double.tryParse(bakiyeController.text) ?? 0,
                  islemGecmisi: [],
                );
                await veriYoneticisi.yeniOgrenciEkle(yeniOgrenci);
                Navigator.pop(context);
                setState(() {});
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text('${yeniOgrenci.adSoyad} başarıyla eklendi!'),
                    backgroundColor: Colors.green,
                  ),
                );
              }
            },
          ),
        ],
      ),
    );
  }

  Widget _istatistikler() {
    final screenWidth = MediaQuery.of(context).size.width;
    final isTablet = screenWidth > 600;

    // Ürün satış verilerini sırala (en çok satandan en aza)
    var siraliUrunler = veriYoneticisi.urunSatislari.entries.toList()
      ..sort((a, b) => b.value.compareTo(a.value));

    // En çok satan 5 ürünü al
    var top5 = siraliUrunler.take(5).toList();

    if (top5.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.bar_chart, size: 100, color: Colors.grey),
            SizedBox(height: 20),
            Text(
              'Henüz satış verisi yok',
              style: TextStyle(fontSize: 20, color: Colors.grey),
            ),
          ],
        ),
      );
    }

    return Padding(
      padding: EdgeInsets.all(isTablet ? 24 : 12),
      child: isTablet
          ? Row(
              children: [
                // Tablet - Yan yana
                _buildGrafikWidget(top5, isTablet),
                SizedBox(width: 20),
                _buildDetayWidget(top5, isTablet),
              ],
            )
          : Column(
              children: [
                // Telefon - Alt alta
                Expanded(child: _buildGrafikWidget(top5, isTablet)),
                SizedBox(height: 12),
                Expanded(child: _buildDetayWidget(top5, isTablet)),
              ],
            ),
    );
  }

  Widget _buildGrafikWidget(List<MapEntry<String, int>> top5, bool isTablet) {
    return Expanded(
      flex: isTablet ? 3 : 1,
      child: Card(
        elevation: 4,
        child: Padding(
          padding: EdgeInsets.all(isTablet ? 20 : 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'En Çok Satan Ürünler',
                style: TextStyle(
                    fontSize: isTablet ? 24 : 18, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: 10),
              Text(
                'Bu ayki satış istatistikleri',
                style: TextStyle(
                    fontSize: isTablet ? 14 : 12, color: Colors.grey[600]),
              ),
              SizedBox(height: isTablet ? 30 : 20),
              Expanded(
                child: BarChart(
                  BarChartData(
                    alignment: BarChartAlignment.spaceAround,
                    maxY: (top5.first.value * 1.2).toDouble(),
                    barTouchData: BarTouchData(
                      enabled: true,
                      touchTooltipData: BarTouchTooltipData(
                        getTooltipItem: (group, groupIndex, rod, rodIndex) {
                          return BarTooltipItem(
                            '${top5[group.x.toInt()].key}\n${top5[group.x.toInt()].value} satış',
                            TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold),
                          );
                        },
                      ),
                    ),
                    titlesData: FlTitlesData(
                      show: true,
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          getTitlesWidget: (value, meta) {
                            if (value.toInt() >= 0 &&
                                value.toInt() < top5.length) {
                              String urunIsmi = top5[value.toInt()].key;
                              // Uzun isimleri kısalt
                              if (urunIsmi.length > 15) {
                                urunIsmi = urunIsmi.substring(0, 15) + '...';
                              }
                              return Padding(
                                padding: EdgeInsets.only(top: 8),
                                child: Text(
                                  urunIsmi,
                                  style: TextStyle(fontSize: 10),
                                  textAlign: TextAlign.center,
                                ),
                              );
                            }
                            return Text('');
                          },
                        ),
                      ),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 40,
                          getTitlesWidget: (value, meta) {
                            return Text(
                              value.toInt().toString(),
                              style: TextStyle(fontSize: 12),
                            );
                          },
                        ),
                      ),
                      topTitles:
                          AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      rightTitles:
                          AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    ),
                    borderData: FlBorderData(show: false),
                    barGroups: top5.asMap().entries.map((entry) {
                      return BarChartGroupData(
                        x: entry.key,
                        barRods: [
                          BarChartRodData(
                            toY: entry.value.value.toDouble(),
                            color: Colors.indigo,
                            width: 40,
                            borderRadius: BorderRadius.only(
                              topLeft: Radius.circular(6),
                              topRight: Radius.circular(6),
                            ),
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDetayWidget(List<MapEntry<String, int>> top5, bool isTablet) {
    return Expanded(
      flex: isTablet ? 2 : 1,
      child: Card(
        elevation: 4,
        child: Padding(
          padding: EdgeInsets.all(isTablet ? 20 : 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Satış Detayları',
                style: TextStyle(
                    fontSize: isTablet ? 20 : 16, fontWeight: FontWeight.bold),
              ),
              SizedBox(height: isTablet ? 20 : 12),
              Expanded(
                child: ListView.builder(
                  itemCount: top5.length,
                  itemBuilder: (context, index) {
                    final urun = top5[index];
                    return Card(
                      color: Colors.indigo[50],
                      child: ListTile(
                        leading: CircleAvatar(
                          backgroundColor: Colors.indigo,
                          child: Text(
                            '${index + 1}',
                            style: TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.bold,
                                fontSize: isTablet ? 16 : 14),
                          ),
                        ),
                        title: Text(
                          urun.key,
                          style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: isTablet ? 16 : 14),
                        ),
                        trailing: Text(
                          '${urun.value} adet',
                          style: TextStyle(
                            fontSize: isTablet ? 16 : 14,
                            fontWeight: FontWeight.bold,
                            color: Colors.indigo,
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
