// Render the same repository-owned illustrations for web and offline POS.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
const panel = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(panel);
const names = ['drink', 'cookie', 'cake', 'fastfood', 'breakfast', 'bakery', 'icecream', 'basket'];
await fs.mkdir(path.join(repo, 'assets/category-icons'), { recursive: true });
await fs.mkdir(path.join(panel, 'public/category-icons'), { recursive: true });
for (const name of names) {
    const source = await fs.readFile(path.join(repo, 'design/category-icons', `${name}.svg`));
    const png = await sharp(source, { density: 192 }).resize(256, 256).png().toBuffer();
    await fs.writeFile(path.join(repo, 'assets/category-icons', `${name}.png`), png);
    await fs.writeFile(path.join(panel, 'public/category-icons', `${name}.png`), png);
}
console.log('8 category illustrations rendered identically for web and POS.');
