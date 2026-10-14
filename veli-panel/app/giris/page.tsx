'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { signIn, formatPhoneEmail, signUp } from '@/lib/auth';
import { getCurrentVeli } from '@/lib/firestore';

export default function GirisPage() {
    const router = useRouter();
    const [telefon, setTelefon] = useState('');
    const [sifre, setSifre] = useState('');
    const [hatirla, setHatirla] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Görsel formatlama: 555 123 45 67
    const formatPhoneNumber = (value: string) => {
        if (!value) return value;
        const phoneNumber = value.replace(/[^\d]/g, '');
        const len = phoneNumber.length;
        if (len < 4) return phoneNumber;
        if (len < 7) return `${phoneNumber.slice(0, 3)} ${phoneNumber.slice(3)}`;
        if (len < 9) return `${phoneNumber.slice(0, 3)} ${phoneNumber.slice(3, 6)} ${phoneNumber.slice(6)}`;
        return `${phoneNumber.slice(0, 3)} ${phoneNumber.slice(3, 6)} ${phoneNumber.slice(6, 8)} ${phoneNumber.slice(8, 10)}`;
    };

    const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;
        // Kullanıcı 0 ile başlarsa anında sil
        if (val.startsWith('0')) {
            val = val.substring(1);
        }
        // Sadece rakamlara izin ver
        val = val.replace(/[^\d]/g, '');
        
        if (val.length > 10) {
            val = val.slice(0, 10);
        }
        
        setTelefon(formatPhoneNumber(val));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // 1. ADIM: Veri Standardizasyonu
            // Telefon numarasını işlem yapmadan önce MUTLAKA temizliyoruz.
            // Bu değişkeni hem Auth, hem Firestore, hem de Admin kontrolünde kullanacağız.
            const temizTelefon = telefon.replace(/\s/g, '');
            const email = formatPhoneEmail(temizTelefon);

            // 2. ADIM: Standart Giriş Denemesi
            const { user, error: loginError, code: loginErrorCode } = await signIn(email, sifre);

            let currentUser = user;

            // 3. ADIM: Giriş başarısızsa "Just-In-Time" (Anında) Kayıt Kontrolü
            if (!user) {
                // Hata türünü kontrol et: Kullanıcı mı yok, şifre mi yanlış?
                const isAuthError = loginErrorCode === 'auth/user-not-found' ||
                    loginErrorCode === 'auth/invalid-credential' ||
                    loginError?.includes('user-not-found') ||
                    loginError?.includes('invalid-credential');

                // Konsoldaki hataları kullanıcıya tekrar yansıtmak yerine, burada işleyip temiz bir mesaj döndüreceğiz.
                console.log("Login attempt failed:", loginErrorCode); // Debug log (cleaner)

                // Eğer kullanıcı bulunamadıysa VE şifre varsayılan (111111) ise
                if (isAuthError && sifre === '111111') {

                    // DİKKAT: Burada signUp fonksiyonuna 'adSoyad' göndermiyoruz.
                    // Çünkü Firestore'da Admin tarafından oluşturulmuş bir kayıt varsa (öğrenci listesi vb.),
                    // 'adSoyad: ""' göndererek o veriyi ezmek istemeyiz.
                    // lib/auth.ts içindeki signUp fonksiyonunun { merge: true } kullandığından emin olun.
                    const { user: newUser, error: signUpError } = await signUp(email, sifre, {
                        telefonNo: temizTelefon
                    });

                    if (newUser) {
                        currentUser = newUser;
                    } else if (signUpError?.includes('email-already-in-use')) {
                        // Eğer email kullanımda diyorsa, demek ki kullanıcı var ama şifre 111111 değil.
                        const errorMsg = 'Hesabınız zaten mevcut ancak şifreniz 111111 değil. Şifrenizi unuttuysanız "Şifremi Unuttum" bağlantısını kullanın.';
                        setError(errorMsg);
                        setLoading(false);
                        return; // Stop execution
                    } else {
                        throw new Error('Kayıt oluşturulamadı. Okul yönetiminde kaydınız olmayabilir.');
                    }
                } else {
                    // Şifre 111111 değilse veya başka bir hata varsa
                    throw new Error('Giriş başarısız. Telefon numaranızı veya şifrenizi kontrol edin.');
                }
            }

            // 4. ADIM: Kullanıcı (Eski veya Yeni) Doğrulandıysa
            if (currentUser) {
                const veliData = await getCurrentVeli(currentUser);

                // Aktiflik Kontrolü
                if (veliData && veliData.aktif === false) {
                    throw new Error('Hesabınız pasif durumdadır. Lütfen okul yönetimi ile iletişime geçiniz.');
                }

                // Yönetici yetkisi, istemcinin değiştirebildiği telefon/rol
                // değerinden değil Firebase Auth özel yetkisinden alınır.
                const token = await currentUser.getIdTokenResult();
                const isAdmin = token.claims.admin === true;

                if (isAdmin) {
                    router.push('/admin');
                } else {
                    router.push('/dashboard');
                }
            }

        } catch (err: any) {
            // Kullanıcıya gösterilecek temiz hata mesajı
            setError(err.message || 'Bir hata oluştu. Lütfen tekrar deneyin.');
            console.error("Giriş İşlemi Hatası:", err);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 overflow-hidden relative bg-slate-50">
            {/* Arka Plan Efektleri */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden z-0 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-400/20 rounded-full blur-[100px] animate-pulse"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-400/20 rounded-full blur-[100px] animate-pulse" style={{ animationDelay: '1s' }}></div>
            </div>

            <div className="w-full max-w-md relative z-10">
                <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-white p-8 md:p-10">

                    {/* Başlık Bölümü */}
                    <div className="text-center mb-10">
                        <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl mb-6 shadow-lg shadow-blue-500/20 transform hover:scale-105 transition-transform duration-300">
                            <span className="text-4xl">🏫</span>
                        </div>
                        <h1 className="text-3xl font-bold text-slate-800 mb-3 tracking-tight">
                            TUGAY BİLSEM OTOMAT PRO
                        </h1>
                        <p className="text-slate-500 text-base">
                            Hoş geldiniz, lütfen giriş yapın
                        </p>
                    </div>

                    {/* Hata Mesajı Alanı */}
                    {error && (
                        <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-xl mb-6 flex items-start gap-3 text-sm animate-in fade-in slide-in-from-top-2">
                            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                            </svg>
                            <div>
                                <p className="font-medium">{error}</p>
                                {error.includes('Şifremi Unuttum') && (
                                    <Link href="/sifre-unuttum" className="block mt-2 font-bold underline hover:text-red-800">
                                        &rarr; Şifremi Sıfırla
                                    </Link>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Giriş Formu */}
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="mb-2">
                            <label className="block text-sm font-semibold text-slate-700 mb-1 ml-1">
                                Telefon Numarası
                            </label>
                            <p className="text-xs text-blue-600 mb-2 ml-1">
                                Başında sıfır (0) olmadan giriniz (Örn: 5XX...)
                            </p>
                            <div className="relative">
                                <input
                                    type="tel"
                                    value={telefon}
                                    onChange={handlePhoneChange}
                                    placeholder="5XX 123 45 67"
                                    maxLength={13}
                                    required
                                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-2 ml-1">
                                Şifre
                            </label>
                            <div className="relative">
                                <input
                                    type="password"
                                    value={sifre}
                                    onChange={(e) => setSifre(e.target.value)}
                                    placeholder="••••••••"
                                    required
                                    className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium text-slate-900 placeholder:text-slate-400"
                                />
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                    </svg>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                            <label className="flex items-center cursor-pointer group">
                                <div className="relative">
                                    <input
                                        type="checkbox"
                                        checked={hatirla}
                                        onChange={(e) => setHatirla(e.target.checked)}
                                        className="sr-only peer"
                                    />
                                    <div className="w-5 h-5 border-2 border-slate-300 rounded peer-checked:bg-blue-600 peer-checked:border-blue-600 transition-all"></div>
                                    <svg className="w-3.5 h-3.5 text-white absolute left-3 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                    </svg>
                                </div>
                                <span className="ml-2 text-sm text-slate-600 group-hover:text-slate-800 transition-colors">Beni hatırla</span>
                            </label>
                            <Link href="/sifre-unuttum" className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors">
                                Şifremi Unuttum
                            </Link>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-500/30 transform transition-all hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    İşleniyor...
                                </span>
                            ) : 'Giriş Yap'}
                        </button>
                    </form>

                    <div className="mt-8 pt-6 border-t border-slate-100 text-center">
                        <p className="text-slate-500 text-sm">
                            Sistem erişimi için okul yönetimi ile iletişime geçiniz.
                        </p>
                    </div>
                </div>

                <p className="text-center text-slate-400 text-xs mt-8">
                    &copy; {new Date().getFullYear()} Okul Otomat Pro. Tüm hakları saklıdır.
                </p>
            </div>
        </div>
    );
}
