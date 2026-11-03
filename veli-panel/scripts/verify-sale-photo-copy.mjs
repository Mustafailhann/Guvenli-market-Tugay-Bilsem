// Optional, Preview-only migration verification. Reads private Blob data from
// Vercel's server, never from the school network. Logs counts only, no photo IDs.
import { get, list } from '@vercel/blob';
import { createHash } from 'node:crypto';

const expected = process.env.PHOTO_COPY_VERIFY_EXPECTED;
if (process.env.VERCEL_ENV !== 'preview' || !expected) process.exit(0);
if (!/^\d+:[a-f0-9]{64}$/.test(expected)) throw new Error('Invalid photo verification configuration');
const project = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
if (!project || !/^[a-z][a-z0-9-]{4,62}$/.test(project)) throw new Error('Missing Firebase project');
const prefix = `sale-photos/${project}/`;
const files = [];
let cursor;
do {
    const page = await list({ prefix, cursor, limit: 1000 });
    files.push(...page.blobs.filter(blob => /^pos_[A-Za-z0-9_-]+\.jpg$/.test(blob.pathname.slice(prefix.length))));
    cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);
const digests = [];
for (let i = 0; i < files.length; i += 6) {
    digests.push(...await Promise.all(files.slice(i, i + 6).map(async file => {
        const blob = await get(file.pathname, { access: 'private', useCache: false, abortSignal: AbortSignal.timeout(20000) });
        if (!blob || blob.statusCode !== 200 || blob.blob.contentType !== 'image/jpeg') throw new Error('Unreadable private photo');
        const bytes = Buffer.from(await new Response(blob.stream).arrayBuffer());
        if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Invalid copied JPEG');
        let end = -1;
        for (let n = bytes.length - 2; n >= Math.max(2, bytes.length - 65538); n--) {
            if (bytes[n] === 255 && bytes[n + 1] === 217) { end = n + 2; break; }
        }
        if (end < 0) throw new Error('Truncated copied JPEG');
        const jpeg = bytes.subarray(0, end);
        const sha256 = createHash('sha256').update(jpeg).digest('hex');
        return `${file.pathname.slice(prefix.length, -4)}:${sha256}:${jpeg.length}\n`;
    })));
}
const actual = `${digests.length}:${createHash('sha256').update(digests.sort().join('')).digest('hex')}`;
if (actual !== expected) throw new Error(`Photo migration verification failed: ${digests.length} photos read; contents/count differ from local originals`);
console.log(`PHOTO_COPY_VERIFIED: ${digests.length} private JPEGs match the local SHA-256 manifest. No source files deleted. No Firestore writes.`);
