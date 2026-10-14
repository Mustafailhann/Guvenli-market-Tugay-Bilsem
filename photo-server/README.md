# İşlem fotoğrafları: bilgisayarda saklama

POS fotoğrafı önce tabletin uygulama belgelerine kaydeder. Satış/bakiye/stok işlemi fotoğraf sunucusunu beklemez. Satış Firebase'e yazıldıktan sonra fotoğraf bağımsız kuyruktan gönderilir; bağlantı veya bilgisayar kapalıysa dosya tablette kalır ve yeniden denenir. Panel, fotoğrafı yalnızca giriş yapmış yöneticiye veya o öğrencinin kayıtlı velisine gösterir.

## Canlıya almadan önce

1. **Hesap hazırlığı ve Firestore güvenliği:** Canlı Firestore kuralları açık erişime izin veriyorsa, veli/öğrenci ilişkisi veya yönetici rolü sahte olarak değiştirilebilir. Fotoğraf sunucusunu internete açmadan önce gerçek hesapların geçişini tamamlayın. Geçici yönetici hizmet hesabıyla `prepare-firestore-access.js` dosyasını önce parametresiz çalıştırıp çakışma raporunu inceleyin; yedek alındıktan sonra `--apply` ile gerekli veli/POS bağlantılarını ve yönetici yetkilerini hazırlayın. Ardından `firestore.rules` kurallarını gerçek yönetici, veli ve POS hesaplarıyla doğrulayıp yayınlayın. Geçici yönetici anahtarını geçiş sonunda iptal edin; fotoğraf sunucusunda yalnız okuma yetkili ayrı anahtarı kullanın.
2. **DNS:** `tugaybilsemkantin.com.tr` üzerindeki mevcut web ve e-posta DNS kayıtlarını yedekleyin. Cloudflare hesabı açıp alan adını ekleyin; nameserver değişiminden önce aynı kayıtları doğrulayın. Ardından `fotograf.tugaybilsemkantin.com.tr` alt alan adını bilgisayardaki `127.0.0.1:8787` servisine yönlendiren kalıcı Cloudflare Tunnel kurun. Geçici `trycloudflare.com` tünelini üretimde kullanmayın. Modem port yönlendirmesi gerekmez.
3. **Bilgisayar:** Node.js 22+, `photo-server` klasöründe `npm ci`. Firebase Admin hizmet hesabı dosyasını proje klasörü dışında, yalnızca hizmet kullanıcısının okuyabileceği yerde tutun. Bu anahtarı APK'ya, Vercel'e veya Git'e koymayın.
4. **POS kimliği:** Mevcut tablette Firebase anonim UID'yi doğrulayıp `PHOTO_ALLOWED_POS_UIDS` listesine ekleyin. Yeni yükleme yalnızca bu UID ile oluşturulmuş gerçek satış kaydına izin verir. Mevcut uygulamanın verisini silmeyin; bekleyen satış ve fotoğraflar silinebilir.
5. **Panel:** Vercel proje ortam değişkeni `PHOTO_SERVER_URL=https://fotograf.tugaybilsemkantin.com.tr` olmalı. Web panelini yeniden yayınlayın. POS uygulamasının aynı adresi kullanması için derleme sırasında `--dart-define=PHOTO_SERVER_URL=https://fotograf.tugaybilsemkantin.com.tr` verilebilir; bu adres kaynak kodda varsayılandır.
6. **Süreklilik:** Node sunucusunu bilgisayar açıldığında otomatik başlatılan, yalnızca bu klasöre ve hizmet hesabına erişen bir Windows görevi/hizmeti olarak çalıştırın. `cloudflared` için de Windows hizmetini kurun. Her ikisinin yeniden başladıktan sonra çalıştığını ve dışarıdan test edildiğini doğrulayın.

PowerShell'de yalnızca örnek değişken adları:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS='C:\private\firebase-service-account.json'
$env:FIREBASE_PROJECT_ID='okul-otomat-projesi'
$env:PHOTO_DATA_DIR='D:\OkulFotograflari'
$env:PHOTO_ALLOWED_POS_UIDS='TABLETIN_FIREBASE_UID_DEGERI'
npm start
```

Fotoğraf klasörünü düzenli olarak ayrı bir diske yedekleyin. Bilgisayar kapalı olduğunda fotoğraflar görüntülenemez; tablet fotoğraf yüklemeyi bekletir, satış devam eder. Yüklenemeyen eski çevrimdışı fotoğraflar uygulama belgelerindeki eski klasörden yeni kuyruğa taşınır. Daha önce yalnızca kamera önbelleğinde kalmış ve silinmiş fotoğraflar geri getirilemez.
