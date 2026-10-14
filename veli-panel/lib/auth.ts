// Authentication helper functions

import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut as firebaseSignOut,
    updatePassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    updateEmail,
    User
} from 'firebase/auth';
import {
    doc,
    setDoc,
    Timestamp,
    collection,
    query,
    where,
    getDocs,
    updateDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { Veli } from '@/types';
import { getCurrentVeli } from './firestore';

export async function signUp(email: string, password: string, veliData: { telefonNo: string } & Partial<Omit<Veli, 'veliID' | 'kayitTarihi' | 'aktif'>>) {
    try {
        // Create user in Firebase Auth
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Check for existing record
        const q = query(collection(db, 'veliler'), where('authEmail', '==', email));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            // LINK to existing
            const existingDoc = querySnapshot.docs[0];
            await updateDoc(doc(db, 'veliler', existingDoc.id), {
                authID: user.uid,
                // Ensure password change is mandatory for new link
                sifreDegistirmeZorunlu: true
            });
        } else {
            // CREATE new
            const veliDoc: Veli = {
                veliID: user.uid,
                ...veliData,
                adSoyad: veliData.adSoyad || 'İsimsiz Veli', // Set default if missing
                authID: user.uid,
                authEmail: email,
                kayitTarihi: Timestamp.now(),
                aktif: true,
                sifreDegistirmeZorunlu: true // Force for new users
            };
            await setDoc(doc(db, 'veliler', user.uid), veliDoc);
        }

        return { success: true, user };
    } catch (error: any) {
        // Don't log expected auth errors to console to avoid alarm
        if (error.code !== 'auth/email-already-in-use') {
            console.error('Sign up error:', error);
        }
        return { success: false, error: error.message, code: error.code }; // also return code
    }
}

export async function signIn(email: string, password: string) {
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        return { success: true, user: userCredential.user };
    } catch (error: any) {
        // Don't log expected auth errors to console to avoid alarm
        if (error.code !== 'auth/invalid-credential' && error.code !== 'auth/user-not-found') {
            console.error('Sign in error:', error);
        }
        return { success: false, error: error.message, code: error.code };
    }
}

export async function signOut() {
    try {
        await firebaseSignOut(auth);
        return { success: true };
    } catch (error: any) {
        console.error('Sign out error:', error);
        return { success: false, error: error.message };
    }
}

export function getCurrentUser(): User | null {
    return auth.currentUser;
}

export function formatPhoneEmail(phone: string): string {
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 11 && cleanPhone.startsWith('0')) {
        cleanPhone = cleanPhone.slice(1);
    }
    return `${cleanPhone}@okul.local`;
}

export async function changeUserPassword(newPassword: string, oldPassword?: string) {
    const user = auth.currentUser;
    if (!user) return { success: false, error: 'Kullanıcı oturumu bulunamadı.' };

    try {
        if (oldPassword && user.email) {
            // Re-authenticate if old password is provided (good practice)
            const credential = EmailAuthProvider.credential(user.email, oldPassword);
            await reauthenticateWithCredential(user, credential);
        }

        await updatePassword(user, newPassword);

        // Update the Firestore flag.
        // CRITICAL FIX: The Firestore Doc ID might NOT be the same as user.uid.
        // We must find the correct document first.
        const veli = await getCurrentVeli(user);

        if (veli) {
            // We found the VELI document (could be phone number or whatever ID)
            await updateDoc(doc(db, 'veliler', veli.veliID), {
                sifreDegistirmeZorunlu: false
            });
        } else {
            // Fallback: If for some reason getCurrentVeli returns null but we are logged in,
            // try to update/create at user.uid just in case, though this is less likely to be the main record.
            console.warn("Veli record not found during password change, attempting fallack update at UID.");
            await setDoc(doc(db, 'veliler', user.uid), {
                sifreDegistirmeZorunlu: false
            }, { merge: true });
        }

        return { success: true };
    } catch (error: any) {
        console.error('Password change error:', error);
        return { success: false, error: error.message };
    }
}

export async function changeAdminSettings(currentPassword: string, newPhone?: string, newPassword?: string) {
    const user = auth.currentUser;
    if (!user || !user.email) return { success: false, error: 'Kullanıcı oturumu bulunamadı.' };

    try {
        // 1. Re-authenticate
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        // 2. Change password if requested
        if (newPassword && newPassword.length >= 6) {
            await updatePassword(user, newPassword);
        }

        // 3. Change email & phone if requested
        if (newPhone && newPhone.length >= 10) {
            const cleanPhone = newPhone.replace(/[^\d]/g, '');
            const newEmail = formatPhoneEmail(cleanPhone);
            await updateEmail(user, newEmail);
            
            // Update Firestore
            const veli = await getCurrentVeli(user);
            if (veli) {
                await setDoc(doc(db, 'veliler', veli.veliID), {
                    telefonNo: cleanPhone,
                    authEmail: newEmail
                }, { merge: true });
            } else {
                await setDoc(doc(db, 'veliler', user.uid), {
                    telefonNo: cleanPhone,
                    role: 'admin' // Ensure they don't lose admin context if newly merged
                }, { merge: true });
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error('Settings change error:', error);
        if (error.code === 'auth/invalid-credential') {
            return { success: false, error: 'Mevcut şifrenizi yanlış girdiniz. Lütfen tekrar deneyin.' };
        }
        if (error.code === 'auth/requires-recent-login') {
            return { success: false, error: 'Güvenlik için lütfen çıkış yapıp tekrar giriş yaptıktan sonra deneyiniz.' };
        }
        if (error.code === 'auth/email-already-in-use') {
            return { success: false, error: 'Bu telefon numarası zaten kullanımda.' };
        }
        return { success: false, error: error.message };
    }
}
