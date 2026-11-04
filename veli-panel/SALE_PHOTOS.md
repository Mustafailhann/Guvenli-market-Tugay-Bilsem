# Satış fotoğraflarını özel Vercel Blob'a taşıma

Firebase Auth, öğrenciler, satış, bakiye ve stok kayıtları mevcut Firestore'da kalır.
Fotoğraf API'sinin Firestore istemcisi yalnız GET / runQuery yapar; yönetici anahtarı kullanmaz.
Her dosya `sale-photos/<Firebase proje kimliği>/<satış kimliği>.jpg` anahtarında saklanır.
Depo **Private** olmalıdır. Fotoğraf okumak için Firebase oturumu ve etkin yönetici
veya ilgili öğrenciye bağlı veli kaydı gerekir. POS yalnız kendi tamamlanmış satışının
fotoğrafını yükleyebilir. Farklı içerik mevcut fotoğrafın üzerine yazılamaz.

## Yayın sırası

1. Projeye Private Blob deposunu bağlayın. Vercel bağlantısının oluşturduğu
   `BLOB_STORE_ID` ve OIDC yetkilendirmesini kullanın; tarayıcıya/APK'ya depo anahtarı koymayın.
2. Mevcut `NEXT_PUBLIC_FIREBASE_PROJECT_ID` ve `NEXT_PUBLIC_FIREBASE_API_KEY`
   üretim ortamında kalmalıdır. Sunucu Firebase ID token imzasını, hesabın etkinliğini
   ve oturumun iptal edilmediğini doğrular. Firestore okumaları aynı token ile
   mevcut güvenlik kurallarına tabidir; kurallarda değişiklik gerekmez.
3. Yerel JPEG'leri önce aşağıdaki audit komutuyla doğrulayın. Ardından aynı komuta
   `--apply` ekleyerek kopyalayın. Manifestte `copied-and-verified` dosyaların
   buluttan geri okunmuş SHA-256 özeti doğrulanmıştır. Kaynaklar silinmez.
4. Vercel Production'da `PHOTO_STORAGE_BACKEND=vercel-blob` ayarlayıp webi yayımlayın.
   Bu değişken yokken mevcut GET fotoğraf servisi çalışmaya devam eder; yeni PUT
   503 döner ve tablet fotoğrafı saklar. `PHOTO_SERVER_URL` yalnız bulut kapalıyken
   eski fotoğraf kaynağına geri dönmek için korunur.
   Bulut etkinken eksik JPEG doğrudan 404 döner; eski tünele başvurulmaz.
5. POS 1.0.9'u mevcut uygulamanın üzerine kurun. Yeni kuyruk ana panelin HTTPS/443
   adresine gönderir. Satış internetsizken fotoğraf kalıcı dosyada bekler;
   satış Firestore'a ulaşmadan yüklemeye 404 verilmesi tekrar denenecek durumdur.
   Dosya ancak aynı satış kimliği ve aynı SHA-256 onayı alındığında silinir.
6. Yetkili yönetici ve ilgili veli ile görüntüleme, yetkisiz veli ile ret ve
   FATİH ağından yeni satış fotoğrafı yükleme/görüntülemeyi doğrulayın.
   HTTPS/443 kullanımı ağ filtresinden kesin geçiş garantisi değildir.

Audit/kopyalama komutu (Node 24; anahtarlar yalnız ortam değişkenlerinde):

```powershell
# GOOGLE_APPLICATION_CREDENTIALS = mevcut salt okunur anahtarın yerel yolu
# NEXT_PUBLIC_FIREBASE_PROJECT_ID = mevcut proje
# BLOB_READ_WRITE_TOKEN = yalnız yerel geçiş için güvenli ortamdan alınan depo token'ı
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/migrate-sale-photos.ts --source C:\ProgramData\KantinPhotoServer\photos --manifest C:\GuvenliYedek\photo-manifest.json
```

## Test ve geri dönüş

Üretim yerine yalnız Preview üzerinde test etmek için `PHOTO_STORAGE_BACKEND`
değişkenini yalnız test dalının Preview ortamına ekleyin. `PHOTO_COPY_VERIFY_EXPECTED`
(`adet:sha256`) ve `npm run verify:photo-copy` isteğe bağlı, elle çalıştırılan Preview
kopyalama kontrolüdür: depodaki bütün JPEG'leri
Vercel sunucusundan okur ve yerel dosyaların sıralı `satışKimliği:sha256:boyut\n`
manifestinin birleşik SHA-256 özetiyle karşılaştırır. Log yalnız doğrulanan adedi
gösterir. İlk 186 dosyanın buluttan okunarak doğrulanması 3 Kasım 2026'da tamamlandı.
Yeni satışlar kopyalama manifestinin dışında kaldığı için kontrol artık otomatik
derleme adımı değildir. Bu kontrol Production'da çalışmaz.

Preview adresleri Vercel oturumu isteyebilir. POS'a Vercel erişim anahtarı veya
koruma atlama belirteci eklemeyin. Kullanıcı canlı geçişi onaylamadan ana alan adının
yükleme yolu kullanılabilir kabul edilmemeli; APK bu aşamada dosyaları kuyruğunda tutar.

`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/sale-photos.test.ts`
ve normal web üretim derlemesi çalıştırılır. Stok transaction testleri yalnız yerel
Firestore emülatöründe çalıştırılır. Fotoğraf geçişi muhasebe kodunu veya kurallarını
değiştirmez. Başarısız dosya yükleme satışın tekrar işlenmesini tetiklemez.

Webi eski fotoğraf kaynağına döndürmek için `PHOTO_STORAGE_BACKEND` değişkenini
kaldırıp yeniden yayımlayın. Yeni APK bulut tekrar etkinleşene kadar fotoğrafları
silmeden bekletir. Bilgisayar JPEG'lerini ve manifesti canlı doğrulama bitene kadar koruyun.

## Plan

Hobby kotası dolduğunda fotoğraf işlemleri durabilir; kuyruk dosyaları korunur.
Vercel Hobby ticari kullanım için değildir. Okullara satılacak canlı hizmet için
uygun ticari plan kullanıcı tarafından onaylanıp etkinleştirilmelidir.
