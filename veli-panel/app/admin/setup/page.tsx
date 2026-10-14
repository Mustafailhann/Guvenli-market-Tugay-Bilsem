'use client';

import { useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, setDoc, updateDoc, doc } from 'firebase/firestore';
import { Timestamp } from 'firebase/firestore';

// Bu sayfa bir kez kullanılır: adminleri Firestore'a eklemek için.
// /admin/setup adresinden erişilir.

const ADMINS_TO_ADD = [
    {
        telefonNo: '5056310572',
        adSoyad: 'Ali Demir',
        unvan: 'Müdür',
        role: 'admin' as const,
        aktif: true,
        sifreDegistirmeZorunlu: true,
    },
    {
        telefonNo: '5054079537',
        adSoyad: 'Nuri Özen',
        unvan: 'Müdür Yardımcısı',
        role: 'admin' as const,
        aktif: true,
        sifreDegistirmeZorunlu: true,
    },
];

export default function SetupAdminsPage() {
    const [results, setResults] = useState<string[]>([]);
    const [loading, setLoading] = useState(false);
    const [done, setDone] = useState(false);

    const handleSetup = async () => {
        setLoading(true);
        const log: string[] = [];

        for (const admin of ADMINS_TO_ADD) {
            try {
                const q = query(
                    collection(db, 'veliler'),
                    where('telefonNo', '==', admin.telefonNo)
                );
                const snapshot = await getDocs(q);

                if (!snapshot.empty) {
                    const docRef = snapshot.docs[0].ref;
                    await updateDoc(docRef, {
                        adSoyad: admin.adSoyad,
                        unvan: admin.unvan,
                        role: admin.role,
                        aktif: admin.aktif,
                        authEmail: `${admin.telefonNo}@okul.local`,
                    });
                    log.push(`✅ Güncellendi: ${admin.adSoyad} (${admin.unvan})`);
                } else {
                    const newRef = doc(collection(db, 'veliler'));
                    await setDoc(newRef, {
                        veliID: newRef.id,
                        ...admin,
                        authEmail: `${admin.telefonNo}@okul.local`,
                        kayitTarihi: Timestamp.now(),
                    });
                    log.push(`✅ Eklendi: ${admin.adSoyad} (${admin.unvan})`);
                }
            } catch (e: any) {
                log.push(`❌ Hata (${admin.adSoyad}): ${e.message}`);
            }
        }

        setResults(log);
        setLoading(false);
        setDone(true);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-8">
            <div className="bg-white rounded-3xl shadow-lg p-10 max-w-lg w-full">
                <h1 className="text-2xl font-bold text-slate-800 mb-2">Admin Kurulum</h1>
                <p className="text-slate-500 mb-6 text-sm">
                    Bu sayfa, aşağıdaki yöneticileri sisteme ekler. Sadece bir kez çalıştırın.
                </p>

                <div className="space-y-3 mb-8">
                    {ADMINS_TO_ADD.map((a) => (
                        <div key={a.telefonNo} className="bg-slate-50 rounded-xl p-4 flex items-center gap-3">
                            <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold text-sm">
                                {a.adSoyad.split(' ').map(n => n[0]).join('')}
                            </div>
                            <div>
                                <p className="font-semibold text-slate-800">{a.adSoyad}</p>
                                <p className="text-xs text-slate-500">{a.unvan} · {a.telefonNo}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {!done ? (
                    <button
                        onClick={handleSetup}
                        disabled={loading}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all disabled:opacity-50"
                    >
                        {loading ? 'İşleniyor...' : 'Yöneticileri Ekle / Güncelle'}
                    </button>
                ) : (
                    <div className="space-y-2">
                        {results.map((r, i) => (
                            <div key={i} className="bg-green-50 border border-green-200 rounded-xl p-3 text-sm text-green-800">
                                {r}
                            </div>
                        ))}
                        <p className="text-center text-slate-400 text-xs mt-4">
                            İşlem tamamlandı. Bu sayfayı kapatabilirsiniz.
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
