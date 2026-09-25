
import {
    collection,
    addDoc,
    updateDoc,
    doc,
    query,
    where,
    getDocs,
    writeBatch,
    increment,
    arrayUnion,
    deleteDoc,
    getDoc,
    runTransaction,
    orderBy
} from 'firebase/firestore';
import { db } from './firebase';
import { formatPhoneEmail } from './auth';
import { Ogrenci, Veli, Islem, KartUcreti, UrunKalemi, isHarcama } from '@/types';
import { Timestamp } from 'firebase/firestore';

// NOTE: Creating Auth users requires Firebase Admin SDK or Cloud Functions if running from Client.
// Since we are running on Client, we can only create the current user via signUp.
// However, the requirement is "Admin adds new Parent".
// This typically requires a Secondary Auth App instance or a Cloud Function.
// For this MVP/Hybrid solution, check if we can simulate it or if we should just create the Firestore records 
// and let the parent "Claim" the account or Register with that phone number.
//
// STRATEGY: 
// 1. Admin creates Firestore "Veli" record with `telefonNo`.
// 2. Parent "Registers" using valid Phone. System checks if Phone matches a Veli record.
//
// OR (User Prompt implies Admin does full registration):
// "Yönetici, sisteme yeni veli kaydı yapabilir."
// If we want actual Auth user creation, we need Cloud Functions.
// assuming we can't spin up CF right now easily without backend code.
//
// ALTERNATIVE: Use a secondary Firebase App instance initialized with Admin credentials? 
// No, that's unsafe on client.
//
// PRACTICAL APPROACH:
// Admin creates the Firestore entries.
// Parent creates their own Auth account using "Sign Up" page, 
// BUT the Sign Up is only allowed if the Phone Number exists in the "Pre-approved Parents" list 
// OR Admin creates a temporary fake auth? 
// 
// Let's stick to: Admin creates Firestore Data. 
// Parent "Login" flow:
// If Auth User doesn't exist => "Account not found".
// Actually, maybe Admin can creates the Auth user if we provide a temporary password?
// But Client SDK cannot create *another* user without logging out the current Admin.
//
// SOLUTION: Admin creates the DATA (Student + Parent info).
// We'll implement a "Register" page that verifies the Phone Number against the stored Data.
// If match found => Create Auth User (link UID to existing Veli Doc).

export async function adminAddStudent(
    studentData: Partial<Ogrenci>,
    parents: { phone: string; name: string }[]
) {
    try {
        // 1. Resolve Parents
        const parentIds: string[] = [];
        const parentPhones: string[] = [];
        const batch = writeBatch(db);

        // Ensure student has an ID (if not provided, auto-gen)
        const studentRef = doc(collection(db, 'ogrenciler'));
        const studentId = studentData.kartID || studentRef.id; // Use provided ID (TC) or auto-gen

        // Check/Create Parents
        for (const parent of parents) {
            const phone = parent.phone;
            if (!phone) continue;

            parentPhones.push(phone);
            const q = query(collection(db, 'veliler'), where('telefonNo', '==', phone));
            const querySnapshot = await getDocs(q);

            let parentId = '';

            if (!querySnapshot.empty) {
                // Parent exists
                const pDoc = querySnapshot.docs[0];
                parentId = pDoc.id;
                // Optional: Update name if missing?
            } else {
                // Create New Parent
                const newParentRef = doc(collection(db, 'veliler'));
                parentId = newParentRef.id;
                batch.set(newParentRef, {
                    veliID: parentId,
                    telefonNo: phone,
                    adSoyad: parent.name || '',
                    aktif: true,
                    sifreDegistirmeZorunlu: true,
                    kayitTarihi: Timestamp.now()
                });
            }
            parentIds.push(parentId);
        }

        // 2. Create Student
        const newStudentData = {
            ...studentData,
            kartID: studentId,
            veliIDleri: parentIds,
            veliTelefonlari: parentPhones,
            islemGecmisi: [],
            bakiye: 0
        };

        batch.set(studentRef, newStudentData);

        await batch.commit();
        return { success: true, studentId };

    } catch (error: any) {
        console.error("Error adding student:", error);
        return { success: false, error: error.message };
    }
}

export async function adminUpdateParentPhone(veliId: string, newPhone: string) {
    try {
        // Update Firestore
        // Note: Auth Email change (phone@okul.local) requires Auth API which needs User Credential.
        // Admin cannot easily change another user's Auth Email from Client SDK.
        // This effectively "Deactivates" the old Auth login if we rely on email link.
        // We might need to instruct Parent to re-register or use Cloud Function.

        // For now, update Firestore.
        await updateDoc(doc(db, 'veliler', veliId), {
            telefonNo: newPhone
        });

        // Also update all linked students
        // Queries are needed... costly.
        // Maybe just keep it loose for now.

        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function getAllStudents() {
    try {
        const q = query(collection(db, 'ogrenciler'));
        const querySnapshot = await getDocs(q);
        const students: Ogrenci[] = [];
        querySnapshot.forEach((doc) => {
            students.push({ id: doc.id, ...doc.data() } as any);
        });
        return students;
    } catch (error) {
        console.error("Error fetching students:", error);
        return [];
    }
}

export async function addStudentBalance(studentId: string, amount: number) {
    try {
        const studentRef = doc(db, 'ogrenciler', studentId);

        const newTransaction: Islem = {
            tarih: Timestamp.now(),
            tip: 'Bakiye Yükleme',
            tutar: amount,
            aciklama: 'Admin tarafından yüklendi',
            urunler: []
        };

        await updateDoc(studentRef, {
            bakiye: increment(amount),
            islemGecmisi: arrayUnion(newTransaction)
        });

        return { success: true };
    } catch (error: any) {
        console.error("Error adding balance:", error);
        return { success: false, error: error.message };
    }
}

export async function setStudentBalance(studentId: string, newBalance: number, oldBalance: number) {
    try {
        const studentRef = doc(db, 'ogrenciler', studentId);
        const diff = newBalance - oldBalance;

        const newTransaction: Islem = {
            tarih: Timestamp.now(),
            tip: 'Bakiye Yükleme',
            tutar: diff,
            aciklama: `Admin bakiye düzeltmesi: ${oldBalance.toFixed(2)} ₺ → ${newBalance.toFixed(2)} ₺`,
            urunler: []
        };

        await updateDoc(studentRef, {
            bakiye: newBalance,
            islemGecmisi: arrayUnion(newTransaction)
        });

        return { success: true };
    } catch (error: any) {
        console.error("Error setting balance:", error);
        return { success: false, error: error.message };
    }
}

export async function addKartUcreti(
    studentId: string,
    tutar: number           // Bu kart için alınan ücret (örn: 50 TL, 200 TL...)
): Promise<{ success: boolean; error?: string }> {
    try {
        if (tutar <= 0) {
            return { success: false, error: 'Tutar sıfırdan büyük olmalıdır.' };
        }

        const studentRef = doc(db, 'ogrenciler', studentId);
        const studentSnap = await getDoc(studentRef);

        if (!studentSnap.exists()) {
            return { success: false, error: 'Öğrenci bulunamadı.' };
        }

        const data = studentSnap.data();
        const mevcutGecmis: KartUcreti[] = data.kartUcretiGecmisi || [];
        const islemNo = mevcutGecmis.length + 1; // Kaçıncı kart

        const yeniKartUcreti: KartUcreti = {
            tarih: Timestamp.now(),
            tutar,
            islemNo,
            aciklama: `${islemNo}. Kart: ${tutar.toFixed(2)} ₺`
        };

        const batch = writeBatch(db);
        batch.update(studentRef, {
            toplamKartUcreti: increment(tutar),
            kartUcretiGecmisi: arrayUnion(yeniKartUcreti)
        });
        await batch.commit();

        return { success: true };
    } catch (error: any) {
        console.error('Error adding kart ücreti:', error);
        return { success: false, error: error.message };
    }
}

export async function getAllParents() {
    try {
        const q = query(collection(db, 'veliler'));
        const querySnapshot = await getDocs(q);
        const parents: Veli[] = [];
        querySnapshot.forEach((doc) => {
            parents.push({ veliID: doc.id, ...doc.data() } as any);
        });
        return parents;
    } catch (error) {
        console.error("Error fetching parents:", error);
        return [];
    }
}

// --- Parent (Veli) Operations ---

export async function createParent(data: Partial<Veli>) {
    try {
        // Check if phone already exists
        const q = query(collection(db, 'veliler'), where('telefonNo', '==', data.telefonNo));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            return { success: false, error: 'Bu telefon numarası ile kayıtlı bir veli zaten var.' };
        }

        const newRef = doc(collection(db, 'veliler'));
        const newVeli: Veli = {
            veliID: newRef.id,
            adSoyad: data.adSoyad || '',
            telefonNo: data.telefonNo || '',
            aktif: true,
            sifreDegistirmeZorunlu: true, // Default for new admin-created users
            kayitTarihi: Timestamp.now(),
            ...data
        } as Veli;

        await batchInit().set(newRef, newVeli).commit();
        return { success: true, veliID: newRef.id };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function updateParent(veliID: string, data: Partial<Veli>) {
    try {
        await updateDoc(doc(db, 'veliler', veliID), data);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

export async function deleteParent(veliID: string) {
    try {
        await deleteDoc(doc(db, 'veliler', veliID));
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// --- Student Operations ---

export async function deleteStudent(cardID: string) {
    try {
        await deleteDoc(doc(db, 'ogrenciler', cardID));
        return { success: true };
    } catch (error: any) {
        console.error("Error deleting student:", error);
        return { success: false, error: error.message };
    }
}

export async function updateStudent(cardID: string, data: Partial<Ogrenci>) {
    try {
        await updateDoc(doc(db, 'ogrenciler', cardID), data);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
}

// Helper to avoid circular deps if needed, otherwise just use standard batch
function batchInit() {
    return writeBatch(db);
}

// --- Student Photo Upload ---

export async function uploadStudentPhoto(file: File): Promise<string | null> {
    try {
        const { compressImage } = await import('./imageUtils');
        // Resmi 400x400'e küçültüp JPEG olarak sıkıştır, base64 data URL döner
        const dataURL = await compressImage(file, 400, 400, 0.7);
        return dataURL;
    } catch (error) {
        console.error('Error processing student photo:', error);
        return null;
    }
}

// --- Get Parents by IDs (Batch) ---

export async function getParentsByIds(veliIDleri: string[]): Promise<Veli[]> {
    try {
        if (veliIDleri.length === 0) return [];
        const parents: Veli[] = [];

        // Firestore 'in' query supports max 30 items, batch accordingly
        const batchSize = 30;
        for (let i = 0; i < veliIDleri.length; i += batchSize) {
            const batch = veliIDleri.slice(i, i + batchSize);
            const q = query(
                collection(db, 'veliler'),
                where('__name__', 'in', batch)
            );
            const snapshot = await getDocs(q);
            snapshot.forEach((docSnap) => {
                parents.push({ veliID: docSnap.id, ...docSnap.data() } as Veli);
            });
        }

        return parents;
    } catch (error) {
        console.error('Error fetching parents by IDs:', error);
        return [];
    }
}

// --- Bulk Card ID Update ---

function normalizeName(name: string): string {
    if (!name) return '';
    return name
        .toLocaleLowerCase('tr-TR') // Türkçe küçük harfe çevir
        .replace(/ğ/g, 'g')
        .replace(/ü/g, 'u')
        .replace(/ş/g, 's')
        .replace(/ı/g, 'i')
        .replace(/ö/g, 'o')
        .replace(/ç/g, 'c')
        .replace(/â/g, 'a')
        .replace(/î/g, 'i')
        .replace(/û/g, 'u')
        .replace(/[^a-z0-9]/g, '') // Boşlukları ve özel karakterleri tamamen sil
        .trim();
}

export async function bulkUpdateCardIds(
    updates: { adSoyad: string; kartID: string }[]
): Promise<{ success: boolean; updated: number; notFound: string[]; errors: string[] }> {
    const notFound: string[] = [];
    const errors: string[] = [];
    let updated = 0;

    try {
        // Fetch all students once
        const q = query(collection(db, 'ogrenciler'));
        const snapshot = await getDocs(q);

        // Build a name → docID map (normalize using robust function)
        const nameToDocId = new Map<string, string>();
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const normalizedName = normalizeName(data.adSoyad);
            if (normalizedName) {
                nameToDocId.set(normalizedName, docSnap.id);
            }
        });

        // Process in batches of 400 (Firestore batch limit is 500)
        const BATCH_SIZE = 400;
        for (let i = 0; i < updates.length; i += BATCH_SIZE) {
            const chunk = updates.slice(i, i + BATCH_SIZE);
            const batch = writeBatch(db);
            let batchHasOp = false;

            for (const { adSoyad, kartID } of chunk) {
                const normalizedName = normalizeName(adSoyad);
                const docId = nameToDocId.get(normalizedName);

                if (!docId) {
                    notFound.push(adSoyad);
                    continue;
                }

                try {
                    const studentRef = doc(db, 'ogrenciler', docId);
                    batch.update(studentRef, { kartID });
                    updated++;
                    batchHasOp = true;
                } catch (e: any) {
                    errors.push(`${adSoyad}: ${e.message}`);
                }
            }

            if (batchHasOp) {
                await batch.commit();
            }
        }

        return { success: true, updated, notFound, errors };
    } catch (error: any) {
        console.error('bulkUpdateCardIds error:', error);
        return { success: false, updated, notFound, errors: [error.message] };
    }
}

// --- Update Student with Parents ---

export async function updateStudentWithParents(
    cardID: string,
    studentData: Partial<Ogrenci>,
    parents: { phone: string; name: string; veliID?: string }[]
) {
    try {
        const batch = writeBatch(db);
        const parentIds: string[] = [];
        const parentPhones: string[] = [];

        for (const parent of parents) {
            const phone = parent.phone;
            if (!phone) continue;

            parentPhones.push(phone);

            if (parent.veliID) {
                // Update existing parent
                const parentRef = doc(db, 'veliler', parent.veliID);
                batch.update(parentRef, {
                    adSoyad: parent.name || '',
                    telefonNo: phone
                });
                parentIds.push(parent.veliID);
            } else {
                // Check if parent exists by phone
                const q = query(collection(db, 'veliler'), where('telefonNo', '==', phone));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot.empty) {
                    const pDoc = querySnapshot.docs[0];
                    parentIds.push(pDoc.id);
                    // Update name if provided
                    if (parent.name) {
                        batch.update(doc(db, 'veliler', pDoc.id), { adSoyad: parent.name });
                    }
                } else {
                    // Create new parent
                    const newParentRef = doc(collection(db, 'veliler'));
                    parentIds.push(newParentRef.id);
                    batch.set(newParentRef, {
                        veliID: newParentRef.id,
                        telefonNo: phone,
                        adSoyad: parent.name || '',
                        aktif: true,
                        sifreDegistirmeZorunlu: true,
                        kayitTarihi: Timestamp.now()
                    });
                }
            }
        }

        // Update student
        const studentRef = doc(db, 'ogrenciler', cardID);
        batch.update(studentRef, {
            ...studentData,
            veliIDleri: parentIds,
            veliTelefonlari: parentPhones
        });

        await batch.commit();
        return { success: true };
    } catch (error: any) {
        console.error('Error updating student with parents:', error);
        return { success: false, error: error.message };
    }
}

// --- Bulk Upsert All Student & Parent Data ---

export async function bulkUpsertStudents(
    studentsData: { 
        adSoyad: string; 
        kartID: string; 
        sinif: string; 
        parents: { name: string; phone: string }[] 
    }[]
): Promise<{ success: boolean; inserted: number; updated: number; errors: string[] }> {
    const errors: string[] = [];
    let inserted = 0;
    let updated = 0;

    try {
        const stdQuery = query(collection(db, 'ogrenciler'));
        const stdSnap = await getDocs(stdQuery);
        
        const existingStudents = new Map<string, any>();
        stdSnap.forEach(snap => {
            const data = snap.data();
            const normName = normalizeName(data.adSoyad);
            if (normName) {
                existingStudents.set(normName, { id: snap.id, ...data });
            }
            if (data.kartID) {
                // Eger isme degil, sadece kart idsine gore aramak gerekirse diye de bir key ekliyoruz.
                // Ornegin 'KART:3503...' şeklinde.
                existingStudents.set('KART:' + data.kartID.toString().trim(), { id: snap.id, ...data });
            }
        });

        const prtQuery = query(collection(db, 'veliler'));
        const prtSnap = await getDocs(prtQuery);
        
        const existingParents = new Map<string, any>();
        prtSnap.forEach(snap => {
            const data = snap.data();
            if (data.telefonNo) {
                existingParents.set(data.telefonNo, { id: snap.id, ...data });
            }
        });

        // Use 200 batch limit as max operations is 500
        const BATCH_SIZE = 200; 
        for (let i = 0; i < studentsData.length; i += BATCH_SIZE) {
            const chunk = studentsData.slice(i, i + BATCH_SIZE);
            const batch = writeBatch(db);

            for (const item of chunk) {
                if (!item.adSoyad) {
                    errors.push("İsimsiz kayıt atlandı.");
                    continue;
                }

                // Prepare Parents
                const parentIds: string[] = [];
                const parentPhones: string[] = [];

                for (const p of item.parents) {
                    if (!p.phone) continue;
                    let phoneStr = p.phone.toString().replace(/\D/g, ''); 
                    if (!phoneStr) continue;

                    parentPhones.push(phoneStr);
                    
                    const existingParent = existingParents.get(phoneStr);
                    if (existingParent) {
                        parentIds.push(existingParent.id);
                        if (p.name && (!existingParent.adSoyad || existingParent.adSoyad.trim() === '')) {
                            // isim boşsa güncelle
                            batch.update(doc(db, 'veliler', existingParent.id), { adSoyad: p.name });
                            existingParent.adSoyad = p.name;
                        }
                    } else {
                        // Yeni veli
                        const newParentRef = doc(collection(db, 'veliler'));
                        const pId = newParentRef.id;
                        parentIds.push(pId);
                        batch.set(newParentRef, {
                            veliID: pId,
                            telefonNo: phoneStr,
                            adSoyad: p.name || '',
                            aktif: true,
                            sifreDegistirmeZorunlu: true,
                            kayitTarihi: Timestamp.now()
                        });
                        existingParents.set(phoneStr, { id: pId, adSoyad: p.name }); 
                    }
                }

                // Student Identification
                const normName = normalizeName(item.adSoyad);
                let existStd = existingStudents.get(normName);
                
                // Fallback check by Kart ID if name did not match but Kart ID provided matches perfectly
                if (!existStd && item.kartID) {
                    existStd = existingStudents.get('KART:' + item.kartID.toString().trim());
                }

                if (existStd) {
                    // Update var olan öğrenci
                    const studentRef = doc(db, 'ogrenciler', existStd.id);
                    batch.update(studentRef, {
                        adSoyad: item.adSoyad.trim(), // İsim güncel halini yaz
                        kartID: item.kartID || existStd.kartID || '',
                        sinif: item.sinif || existStd.sinif || 'Belirsiz',
                        veliIDleri: [...new Set([...(existStd.veliIDleri || []), ...parentIds])],
                        veliTelefonlari: [...new Set([...(existStd.veliTelefonlari || []), ...parentPhones])]
                    });
                    
                    // Memory güncelle
                    existingStudents.set(normName, { 
                        ...existStd, 
                        kartID: item.kartID || existStd.kartID,
                        adSoyad: item.adSoyad.trim(),
                        veliIDleri: [...new Set([...(existStd.veliIDleri || []), ...parentIds])],
                        veliTelefonlari: [...new Set([...(existStd.veliTelefonlari || []), ...parentPhones])]
                    });
                    if (item.kartID) {
                        existingStudents.set('KART:' + item.kartID.trim(), existingStudents.get(normName));
                    }
                    updated++;
                } else {
                    // Yeni öğrenci
                    const newStudentRef = doc(collection(db, 'ogrenciler'));
                    const stdId = item.kartID || newStudentRef.id;
                    
                    batch.set(newStudentRef, {
                        adSoyad: item.adSoyad.trim(), 
                        kartID: stdId,
                        sinif: item.sinif || 'Belirsiz',
                        bakiye: 0,
                        islemGecmisi: [],
                        veliIDleri: parentIds,
                        veliTelefonlari: parentPhones
                    });
                    
                    inserted++;
                    existingStudents.set(normName, { id: newStudentRef.id, kartID: stdId, veliIDleri: parentIds, veliTelefonlari: parentPhones });
                    if (item.kartID) {
                        existingStudents.set('KART:' + item.kartID.trim(), existingStudents.get(normName));
                    }
                }
            }

            await batch.commit();
        }

        return { success: true, inserted, updated, errors };
    } catch (err: any) {
        console.error('Error in bulkUpsertStudents:', err);
        return { success: false, inserted, updated, errors: [...errors, err.message] };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1: Safe Transaction Reversal (no hard deletes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks an islemGecmisi entry as cancelled and atomically adjusts the student's
 * balance in the opposite direction. The record is never deleted.
 *
 * @param studentId  Firestore document ID of the student/personnel
 * @param islemIndex Zero-based index of the Islem in islemGecmisi array
 */
export async function cancelIslem(
    studentId: string,
    islemIndex: number
): Promise<{ success: boolean; error?: string }> {
    try {
        const studentRef = doc(db, 'ogrenciler', studentId);
        const personnelRef = doc(db, 'personeller', studentId);

        await runTransaction(db, async (tx) => {
            const [studentSnap, personnelSnap] = await Promise.all([
                tx.get(studentRef),
                tx.get(personnelRef),
            ]);
            const snap = studentSnap.exists() ? studentSnap : personnelSnap;
            const accountRef = studentSnap.exists() ? studentRef : personnelRef;
            if (!snap.exists()) throw new Error('Öğrenci/personel bulunamadı.');

            const data = snap.data();
            const islemler: Islem[] = data.islemGecmisi || [];
            const islem = islemler[islemIndex];

            if (!islem) throw new Error('İşlem bulunamadı.');
            if (islem.isCancelled) throw new Error('Bu işlem zaten iptal edilmiş.');

            const harcama = isHarcama(islem.tip, islem.tutar);
            const lines = harcama ? (islem.urunler ?? []) : [];
            if (harcama && lines.length > 0 && lines.some(line => typeof line === 'string')) {
                throw new Error(
                    'Eski metin formatındaki satışın stoğu güvenle belirlenemiyor. '
                    + 'Muhasebe tutarlılığı için otomatik iptal durduruldu.'
                );
            }

            const consolidated = new Map<string, UrunKalemi>();
            for (const raw of lines) {
                if (typeof raw === 'string') continue;
                const line = raw as UrunKalemi;
                if (!line.id || !Number.isSafeInteger(line.miktar) || line.miktar <= 0) {
                    throw new Error('Satış kaleminde geçersiz ürün ID/miktarı var; iptal durduruldu.');
                }
                const existing = consolidated.get(line.id);
                consolidated.set(line.id, {
                    ...line,
                    miktar: (existing?.miktar ?? 0) + line.miktar,
                });
            }

            // Bütün stok okumaları herhangi bir yazmadan önce yapılır.
            const productEntries = [...consolidated.entries()];
            const productSnaps = await Promise.all(
                productEntries.map(([productId]) => tx.get(doc(db, 'urunler', productId)))
            );
            productSnaps.forEach((productSnap, index) => {
                if (!productSnap.exists()) {
                    throw new Error(`İptal stoğu için ürün bulunamadı: ${productEntries[index][1].ad}`);
                }
            });

            const updated = islemler.map((item, idx) =>
                idx === islemIndex ? { ...item, isCancelled: true } : item
            );
            // Pozitif kaydedilen Harcama/Ödeme iade edilir; yükleme geri alınır.
            const balanceDelta = harcama ? Math.abs(islem.tutar) : -Math.abs(islem.tutar);

            tx.update(accountRef, {
                islemGecmisi: updated,
                bakiye: increment(balanceDelta)
            });

            productEntries.forEach(([productId, line], index) => {
                const productSnap = productSnaps[index];
                const productData = productSnap.data()!;
                const eskiStok = Number(productData.stok ?? 0);
                const yeniStok = eskiStok + line.miktar;
                const productRef = doc(db, 'urunler', productId);
                tx.update(productRef, { stok: yeniStok });
                tx.set(doc(db, 'stok_hareketleri', `iptal_${studentId}_${islemIndex}_${productId}`), {
                    urunId: productId,
                    urunAdi: productData.ad ?? line.ad,
                    miktarDegisimi: line.miktar,
                    eskiStok,
                    yeniStok,
                    tarih: Timestamp.now(),
                    islemTipi: 'Satış İptali',
                    islemYapan: 'Sistem Yöneticisi',
                    referansId: islem.satisId ?? `${studentId}_${islemIndex}`,
                });
            });

            tx.set(doc(db, 'islem_iptalleri', `${studentId}_${islemIndex}`), {
                hesapId: studentId,
                hesapTuru: studentSnap.exists() ? 'ogrenci' : 'personel',
                islemIndex,
                satisId: islem.satisId ?? null,
                bakiyeDegisimi: balanceDelta,
                stokIadesi: productEntries.map(([productId, line]) => ({
                    urunId: productId,
                    miktar: line.miktar,
                })),
                tarih: Timestamp.now(),
                islemYapan: 'Sistem Yöneticisi',
            });
        });

        return { success: true };
    } catch (error: any) {
        console.error('cancelIslem error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Marks a kartUcretiGecmisi entry as cancelled and atomically subtracts
 * the amount from toplamKartUcreti. The record is never deleted.
 *
 * @param studentId Firestore document ID
 * @param kuIndex   Zero-based index in kartUcretiGecmisi
 */
export async function cancelKartUcreti(
    studentId: string,
    kuIndex: number
): Promise<{ success: boolean; error?: string }> {
    try {
        const studentRef = doc(db, 'ogrenciler', studentId);

        await runTransaction(db, async (tx) => {
            const snap = await tx.get(studentRef);
            if (!snap.exists()) throw new Error('Öğrenci bulunamadı.');

            const data = snap.data();
            const list: KartUcreti[] = data.kartUcretiGecmisi || [];
            const ku = list[kuIndex];

            if (!ku) throw new Error('Kart ücreti kaydı bulunamadı.');
            if (ku.isCancelled) throw new Error('Bu kart ücreti zaten iptal edilmiş.');

            const updated = list.map((item, idx) =>
                idx === kuIndex ? { ...item, isCancelled: true } : item
            );

            tx.update(studentRef, {
                kartUcretiGecmisi: updated,
                toplamKartUcreti: increment(-ku.tutar)
            });
        });

        return { success: true };
    } catch (error: any) {
        console.error('cancelKartUcreti error:', error);
        return { success: false, error: error.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2: Kasa Giderleri (Operating Expenses / Cash Ledger)
// ─────────────────────────────────────────────────────────────────────────────

export type GiderTuru = 'Müdüre Kasa Teslimi' | 'Benzin / Lojistik' | 'Diğer İşletme Gideri';

export interface KasaGideri {
    id: string;         // Firestore document ID
    giderTuru: GiderTuru;
    tutar: number;
    aciklama: string;
    tarih: Timestamp;
}

export async function addKasaGideri(
    data: Omit<KasaGideri, 'id' | 'tarih'>
): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
        const docRef = await addDoc(collection(db, 'kasa_giderleri'), {
            ...data,
            tarih: Timestamp.now()
        });
        return { success: true, id: docRef.id };
    } catch (error: any) {
        console.error('addKasaGideri error:', error);
        return { success: false, error: error.message };
    }
}

export async function getKasaGiderleri(): Promise<KasaGideri[]> {
    try {
        const q = query(
            collection(db, 'kasa_giderleri'),
            orderBy('tarih', 'desc')
        );
        const snap = await getDocs(q);
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as KasaGideri));
    } catch (error) {
        console.error('getKasaGiderleri error:', error);
        return [];
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3: Realized Profit & Loss Aggregation
// ─────────────────────────────────────────────────────────────────────────────

export interface PnlTransaction {
    tarih: Timestamp;
    aciklama: string;
    gelir: number;          // Revenue (sale amount)
    maliyet: number;        // Exact COGS snapshot (0 for legacy records)
    brütKar: number;        // gelir - maliyet
    hasSnapshot: boolean;   // true = exact historical cost; false = legacy record (no cost data)
}

export interface PnlResult {
    toplamGelir: number;        // A: Total Realized Revenue (sales + card fees)
    toplamCOGS: number;         // B: Exact Cost of Goods Sold from cost snapshots
    toplamOPEX: number;         // C: Total Operating Expenses (kasa_giderleri)
    netKar: number;             // D: Net Realized Profit = A - B - C
    transactionCount: number;   // Total number of sales transactions
    snapshotCount: number;      // Transactions WITH exact cost snapshot
    legacyCount: number;        // Transactions WITHOUT cost data (pre-snapshotting, COGS=0)
    kartUcretiToplamı: number;  // Card fees component of revenue
    satirlar: PnlTransaction[]; // Per-transaction breakdown (latest 50)
}

/**
 * Aggregates Realized P&L using IMMUTABLE COST SNAPSHOTS.
 *
 * Revenue sources:
 *   - All students' islemGecmisi (Odeme / Harcama entries) — deposits are EXCLUDED
 *   - All students' kartUcretiGecmisi (card fees)
 *
 * COGS (Satilan Malin Maliyeti):
 *   - Uses islem.toplamMaliyet (snapshotted at checkout by Flutter) when available — 100% accurate
 *   - Legacy records without this field → COGS = 0, flagged hasSnapshot=false
 *   - NO weighted-average estimation. No product collection needed.
 *
 * OPEX: All kasa_giderleri records.
 */
export async function getRealizedPnlData(): Promise<PnlResult> {
    try {
        // Fetch students, personnel, and OPEX in parallel — no product collection needed
        const [studentsSnap, personnelSnap, giderleriSnap] = await Promise.all([
            getDocs(query(collection(db, 'ogrenciler'))),
            getDocs(query(collection(db, 'personeller'))),
            getDocs(query(collection(db, 'kasa_giderleri'), orderBy('tarih', 'desc'))),
        ]);

        let toplamSatisGeliri = 0;
        let toplamCOGS = 0;
        let kartUcretiToplamı = 0;
        let transactionCount = 0;
        let snapshotCount = 0;
        let legacyCount = 0;
        const allTransactions: PnlTransaction[] = [];

        // Combine all people (students + personnel) into a single array loop
        const allProfiles = [...studentsSnap.docs, ...personnelSnap.docs];

        allProfiles.forEach(docSnap => {
            const data = docSnap.data();

            // Sales — deposits (Bakiye Yukleme) are LIABILITIES, strictly excluded
            const islemler: Islem[] = data.islemGecmisi || [];
            for (const islem of islemler) {
                if (islem.isCancelled) continue;
                const isHarcamaIslem =
                    islem.tip === 'Ödeme' ||
                    islem.tip === 'Harcama' ||
                    (islem.tutar != null && islem.tutar < 0);
                if (!isHarcamaIslem) continue;

                const gelir = Math.abs(islem.tutar);
                transactionCount++;
                toplamSatisGeliri += gelir;

                // Use exact snapshot; fall back to 0 for pre-snapshot legacy records
                const hasSnapshot = typeof islem.toplamMaliyet === 'number';
                const maliyet = hasSnapshot ? (islem.toplamMaliyet as number) : 0;
                toplamCOGS += maliyet;

                if (hasSnapshot) snapshotCount++;
                else legacyCount++;

                const isGenericDesc = islem.aciklama === 'Kantin Alışverişi' || !islem.aciklama;
                const displayDesc = (isGenericDesc && islem.urunler && islem.urunler.length > 0)
                    ? islem.urunler.join(', ')
                    : (islem.aciklama || 'Ürün Satışı');

                allTransactions.push({
                    tarih: islem.tarih,
                    aciklama: displayDesc,
                    gelir,
                    maliyet,
                    brütKar: gelir - maliyet,
                    hasSnapshot,
                });
            }

            // Card fees — pure service revenue, no COGS
            const kartUcretleri: KartUcreti[] = data.kartUcretiGecmisi || [];
            for (const ku of kartUcretleri) {
                if (ku.isCancelled) continue;
                kartUcretiToplamı += ku.tutar;
            }
        });

        const toplamGelir = toplamSatisGeliri + kartUcretiToplamı;

        let toplamOPEX = 0;
        giderleriSnap.forEach(d => {
            const g = d.data();
            toplamOPEX += g.tutar ?? 0;
        });

        const netKar = toplamGelir - toplamCOGS - toplamOPEX;

        allTransactions.sort((a, b) => b.tarih.toMillis() - a.tarih.toMillis());
        const satirlar = allTransactions.slice(0, 50);

        return {
            toplamGelir,
            toplamCOGS,
            toplamOPEX,
            netKar,
            transactionCount,
            snapshotCount,
            legacyCount,
            kartUcretiToplamı,
            satirlar,
        };
    } catch (error) {
        console.error('getRealizedPnlData error:', error);
        return {
            toplamGelir: 0,
            toplamCOGS: 0,
            toplamOPEX: 0,
            netKar: 0,
            transactionCount: 0,
            snapshotCount: 0,
            legacyCount: 0,
            kartUcretiToplamı: 0,
            satirlar: [],
        };
    }
}
