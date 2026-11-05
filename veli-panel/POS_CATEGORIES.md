# POS kategorileri

Yönetici menüsündeki **Kategoriler** (`/admin/kategoriler`) ekranından ad, simge,
renk ve sıra düzenlenir; yeni kategori eklenir veya boş kategori kaldırılır.
Değişiklikler **Değişiklikleri Kaydet** ile tek seferde kaydedilir. Ürünü olan
kategoriyi kaldırmadan önce ürünleri Ürünler ekranından başka kategoriye taşıyın.

Tablete bir kez **1.0.10 (11)** veya sonrası APK kurulmalıdır. Sonraki kategori
değişiklikleri internet bağlantısıyla otomatik gelir. Çevrimdışı açılışta son
geçerli ayar kullanılır; henüz ayar indirilmediyse mevcut yedi kategori açılır.
Eski APK'lar sabit kategorileri kullanmaya devam eder; yeni kategori eklemeden
önce bütün POS cihazlarını güncelleyin.

**1.0.11 (12)** sürümünde kategori görselleri web paneliyle aynı, uygulama içine
gömülü ürün çizimleridir. Stoku sıfır veya altında olan ürünler POS satış
listesinde gösterilmez; pozitif stok güncellemesi gelince otomatik geri görünür.
Stok/bakiye işlemleri değişmez. Mevcut `icon` anahtarları eski APK uyumluluğu
için korunur; örneğin `breakfast` kek, `fastfood` gofret, `icecream` çikolata
görseline karşılık gelir. Bu güncelleme Firebase kayıtlarına geçiş yazımı yapmaz.

## Veri sınırı

- Tek ayar belgesi: `app_settings/pos_kategorileri` (şema 1).
- `categories` dizisinin sırası ekran sırasıdır; kayıtlar `key`, `name`, `icon`,
  `color`, `active` alanlarını taşır. `key` değişmez; ürünün mevcut `kategori`
  alanıyla eşleşir. Ad değiştirmek ürün belgelerini yeniden yazmaz.
- Silme `active: false` olarak saklanır. Eski veya eşzamanlı bir ürün bağlantısı
  varsa o kategori yine gösterilir; ürün gizlenmez.
- `revision` transaction içinde karşılaştırılır; eski yönetici taslağı güncel
  ayarı ezemez. Bağlantı/saklama hatası ekranda gösterilir.
- Mevcut yönetici/POS okuma kuralları kullanılır; yeni Firestore kuralı gerekmez.
- Kategori kaydı stok, fiyat, satış, bakiye veya stok defterine yazmaz.

## Doğrulama

Repo kökünde `flutter test --no-pub test/kategori_servisi_test.dart`.
`veli-panel` içinde `node --test tests/category-model.test.ts`.
Yerel Firestore emülatörü çalışırken `FIRESTORE_EMULATOR_HOST=127.0.0.1:8879`
ile `node --test tests/categories.rules.test.mjs tests/products.test.mjs`.
Bu testler yalnız `demo-*` emülatör projelerini kullanır; canlı veriye yazmaz.
