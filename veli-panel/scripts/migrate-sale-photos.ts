// Run locally with the existing READ-ONLY Firebase credential and a private
// Blob credential in environment variables. Never copies any key to Vercel.
// Default is audit-only. --apply copies and verifies; it never deletes files.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hasSalePhoto, saleIdPattern } from '../lib/server/photo-access.ts';
import { normalizeJpeg, photoDigest, photoPath, privatePhotoStore, savePhotoOnce } from '../lib/server/photo-storage.ts';

const args = process.argv.slice(2);
function argument(name: string) { return args[args.indexOf(name) + 1]; }
if (!args.includes('--source') || !args.includes('--manifest') || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('--source, --manifest ve salt okunur Firebase anahtarı ortam değişkeni gerekli.');
}
const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!projectId) throw new Error('NEXT_PUBLIC_FIREBASE_PROJECT_ID gerekli.');
const source = await realpath(argument('--source'));
const manifestPath = path.resolve(argument('--manifest'));
if (!path.isAbsolute(argument('--source'))) throw new Error('Kaynak mutlak yol olmalı.');
const apply = args.includes('--apply');
const db = getFirestore(initializeApp({ projectId, credential: applicationDefault() }, 'photo-migration-reader'));
db.settings({ preferRest: true });
const entries: { saleId: string; sha256?: string; bytes?: number; status: string }[] = [];
const manifest = () => writeFile(manifestPath, JSON.stringify({ projectId, source, apply, createdAt: new Date().toISOString(), entries }, null, 2));
try {
    for (const file of (await readdir(source, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!file.isFile() || !file.name.endsWith('.jpg')) continue;
        const saleId = file.name.slice(0, -4);
        if (!saleIdPattern.test(saleId)) continue;
        const entry: typeof entries[number] = { saleId, status: 'pending' };
        entries.push(entry);
        try {
            const sale = await db.collection('satislar').doc(saleId).get();
            const data = sale.data();
            if (!data || data.durum !== 'tamamlandi' || !hasSalePhoto(data, saleId)) {
                entry.status = 'skipped-no-matching-sale';
                continue;
            }
            const bytes = normalizeJpeg(await readFile(path.join(source, file.name)));
            entry.sha256 = photoDigest(bytes); entry.bytes = bytes.length;
            if (!apply) { entry.status = 'ready'; continue; }
            const key = photoPath(projectId, saleId);
            await savePhotoOnce(privatePhotoStore, key, bytes);
            const uploaded = await privatePhotoStore.read(key);
            if (!uploaded || photoDigest(uploaded) !== entry.sha256) throw new Error('Verification failed');
            entry.status = 'copied-and-verified';
        } catch { entry.status = 'failed'; }
        finally { await manifest(); }
    }
} finally { await manifest(); await db.terminate(); }
const counts = entries.reduce<Record<string, number>>((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1; return result;
}, {});
console.log(JSON.stringify({ mode: apply ? 'copy' : 'audit', total: entries.length, counts, sourceDeleted: 0 }));
if (entries.some(item => item.status === 'failed')) process.exitCode = 1;
