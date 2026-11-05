import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryKey, categoryName, defaultCategorySettings, parseCategorySettings, resolveCategories, validateCategories } from '../lib/category-model.ts';

test('existing category keys and tablet order are retained', () => {
    assert.deepEqual(defaultCategorySettings().categories.map(item => item.key),
        ['İçecekler', 'Atıştırmalıklar', 'Tatlılar', 'Gofretler', 'Kekler', 'Krakerler', 'Çikolatalar']);
});

test('rename and reorder change presentation without moving or modifying products', () => {
    const products = Object.freeze([Object.freeze({ id: 'water', kategori: 'İçecekler', stok: 14, fiyat: 10 })]);
    const before = JSON.stringify(products);
    const categories = defaultCategorySettings().categories.reverse();
    categories.find(item => item.key === 'İçecekler')!.name = 'Soğuk İçecekler';
    assert.equal(categoryName(categories, products[0].kategori), 'Soğuk İçecekler');
    assert.equal(resolveCategories(categories, products.map(item => item.kategori)).at(-1)!.key, 'İçecekler');
    assert.equal(JSON.stringify(products), before);
});

test('legacy and concurrently assigned removed categories never hide products', () => {
    const categories = defaultCategorySettings().categories;
    categories[0].active = false;
    assert.equal(resolveCategories(categories, []).some(item => item.key === 'İçecekler'), false);
    assert.equal(resolveCategories(categories, ['İçecekler', 'Diğer']).some(item => item.key === 'İçecekler'), true);
    assert.equal(resolveCategories(categories, ['İçecekler', 'Diğer']).at(-1)!.name, 'Diğer');
    assert.equal(categoryKey(null), 'Diğer');
});

test('duplicate keys, Turkish duplicate names and invalid fields cannot be saved', () => {
    const defaults = defaultCategorySettings().categories;
    assert.throws(() => validateCategories([...defaults, defaults[0]]));
    assert.throws(() => validateCategories([...defaults, { ...defaults[0], key: 'new', name: 'İÇECEKLER' }]));
    for (const patch of [{ color: 'red' }, { icon: 'unknown' }, { name: '' }, { active: 'yes' }]) {
        assert.throws(() => validateCategories([{ ...defaults[0], ...patch }]));
    }
    assert.throws(() => parseCategorySettings({ schemaVersion: 999, revision: 1, categories: defaults }));
    assert.deepEqual(parseCategorySettings(null), defaultCategorySettings());
});
