// Firestore database helper functions

import {
    collection,
    doc,
    getDoc,
    getDocs,
    addDoc,
    updateDoc,
    query,
    where,
    Timestamp,
    orderBy,
    limit,
    setDoc
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import { db } from './firebase';
import { Veli, CocukTalebi, Ogrenci, CocukWithStatus } from '@/types';

async function ensureParentAuthLink(uid: string, veliId: string) {
    const ref = doc(db, 'parent_auth', uid);
    const current = await getDoc(ref);
    if (!current.exists()) {
        await setDoc(ref, { veliId });
    } else if (current.data().veliId !== veliId) {
        throw new Error('Veli hesabı bağlantısı uyuşmuyor.');
    }
}

// Veli Operations
export async function getVeli(veliID: string): Promise<Veli | null> {
    try {
        const veliDoc = await getDoc(doc(db, 'veliler', veliID));
        if (veliDoc.exists()) {
            return veliDoc.data() as Veli;
        }
        return null;
    } catch (error) {
        console.error('Error fetching veli:', error);
        return null;
    }
}

export async function getCurrentVeli(user: User): Promise<Veli | null> {
    if (!user.email) return null;
    try {
        // 1. Check if we already linked this Auth UID
        // We need an 'authID' field on Veli. 
        // Note: For imported data we don't have this yet.
        // Queries require index if compound, but here simple.

        const qAuth = query(collection(db, 'veliler'), where('authID', '==', user.uid));
        const authSnap = await getDocs(qAuth);

        if (authSnap.size === 1) {
            await ensureParentAuthLink(user.uid, authSnap.docs[0].id);
            return { ...authSnap.docs[0].data(), veliID: authSnap.docs[0].id } as Veli;
        }
        if (authSnap.size > 1) {
            throw new Error('Bu girişe birden fazla veli kaydı bağlanmış.');
        }

        // 2. Not linked? Try Phone Number Match
        // E.g. 5551234567@okul.local -> 5551234567
        const qPhone = query(collection(db, 'veliler'), where('authEmail', '==', user.email));
        const phoneSnap = await getDocs(qPhone);

        if (phoneSnap.size === 1) {
            const veliDoc = phoneSnap.docs[0];
            // LINK ACCOUNTS
            await updateDoc(doc(db, 'veliler', veliDoc.id), {
                authID: user.uid
            });
            await ensureParentAuthLink(user.uid, veliDoc.id);
            const existingData = veliDoc.data() as Veli;
            return { ...existingData, veliID: veliDoc.id, authID: user.uid };
        }
        if (phoneSnap.size > 1) {
            throw new Error('Bu telefona birden fazla veli kaydı bağlı.');
        }

        return null;
    } catch (error) {
        console.error('Error resolving current veli:', error);
        return null;
    }
}

// Cocuk Talepleri Operations
export async function createCocukTalebi(veliID: string, veliAdi: string, cocukAdi: string, sinif?: string) {
    try {
        const talepData: Omit<CocukTalebi, 'talepID'> = {
            veliID,
            veliAdi,
            cocukAdi,
            sinif,
            kartID: null,
            durum: 'beklemede',
            olusturmaTarihi: Timestamp.now(),
        };

        const docRef = await addDoc(collection(db, 'cocukTalepleri'), talepData);
        return { success: true, id: docRef.id };
    } catch (error: any) {
        console.error('Error creating cocuk talebi:', error);
        return { success: false, error: error.message };
    }
}

export async function getCocukTalepleriByVeli(veliID: string): Promise<CocukTalebi[]> {
    try {
        const q = query(
            collection(db, 'cocukTalepleri'),
            where('veliID', '==', veliID)
            // orderBy('olusturmaTarihi', 'desc') // Index gerektirdiği için geçici olarak kapattık
        );
        const querySnapshot = await getDocs(q);

        return querySnapshot.docs.map(doc => ({
            talepID: doc.id,
            ...doc.data()
        } as CocukTalebi));
    } catch (error) {
        console.error('Error fetching cocuk talepleri:', error);
        return [];
    }
}

// Ogrenci Operations
export async function getOgrenci(kartID: string): Promise<Ogrenci | null> {
    try {
        const ogrenciDoc = await getDoc(doc(db, 'ogrenciler', kartID));
        if (ogrenciDoc.exists()) {
            return ogrenciDoc.data() as Ogrenci;
        }
        return null;
    } catch (error) {
        console.error('Error fetching ogrenci:', error);
        return null;
    }
}

// Combined: Get children with their student data
export async function getCocuklarWithData(veliID: string): Promise<CocukWithStatus[]> {
    try {
        // 1. Get existing requests (legacy/manual flow)
        const talepler = await getCocukTalepleriByVeli(veliID);

        const taleplerWithData = await Promise.all(
            talepler.map(async (talep) => {
                if (talep.durum === 'onaylandi' && talep.kartID) {
                    const ogrenciData = await getOgrenci(talep.kartID);
                    return { ...talep, ogrenciData: ogrenciData || undefined };
                }
                return { ...talep, ogrenciData: undefined };
            })
        );

        // 2. Get directly linked (imported/admin-added) students
        // Query: where veliIDleri array-contains veliID
        const q = query(collection(db, 'ogrenciler'), where('veliIDleri', 'array-contains', veliID));
        const directSnapshot = await getDocs(q);

        const directStudents: CocukWithStatus[] = directSnapshot.docs.map(doc => {
            const data = doc.data() as Ogrenci;
            return {
                talepID: `direct_${doc.id}`, // Pseudo-ID
                veliID,
                veliAdi: '', // Not needed for display usually
                cocukAdi: data.adSoyad,
                sinif: data.sinif,
                kartID: doc.id,
                durum: 'onaylandi', // Automatically approved
                olusturmaTarihi: Timestamp.now(), // Pseudo-date
                ogrenciData: data
            };
        });

        // Merge (remove duplicates if any student is both in requests and direct link?)
        // Direct link is the source of truth for "Active" students.
        // Requests are for history/status.
        // Simple merge:
        return [...taleplerWithData, ...directStudents];

    } catch (error) {
        console.error('Error fetching cocuklar with data:', error);
        return [];
    }
}
