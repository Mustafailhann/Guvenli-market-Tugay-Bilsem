import defaults from '../config/pos-categories.json' with { type: 'json' };

export const categoryIcons = [
    // Keep the saved icon keys compatible with previously installed POS versions.
    { value: 'drink', label: 'İçecek', image: '/category-icons/drink.png' },
    { value: 'cookie', label: 'Atıştırmalık', image: '/category-icons/cookie.png' },
    { value: 'cake', label: 'Tatlı', image: '/category-icons/cake.png' },
    { value: 'fastfood', label: 'Gofret', image: '/category-icons/fastfood.png' },
    { value: 'breakfast', label: 'Kek', image: '/category-icons/breakfast.png' },
    { value: 'bakery', label: 'Kraker', image: '/category-icons/bakery.png' },
    { value: 'icecream', label: 'Çikolata', image: '/category-icons/icecream.png' },
    { value: 'basket', label: 'Sepet', image: '/category-icons/basket.png' },
] as const;

export interface PosCategory {
    // Product.kategori keeps this immutable key; renaming never rewrites products.
    key: string;
    name: string;
    icon: string;
    color: string;
    active: boolean;
}
export interface CategorySettings { revision: number; categories: PosCategory[] }
export const categorySettingsPath = 'pos_kategorileri';
export const categoryKey = (value: unknown): string => typeof value === 'string' && value.trim() ? value : 'Diğer';

export function validateCategories(input: unknown): PosCategory[] {
    if (!Array.isArray(input) || input.length > 200) throw new Error('En fazla 200 kategori kaydı kullanılabilir.');
    const keys = new Set<string>();
    const names = new Set<string>();
    return input.map(item => {
        if (!item || typeof item !== 'object' || typeof item.key !== 'string' || !item.key.trim() || item.key.length > 100 ||
            typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 40 ||
            !categoryIcons.some(icon => icon.value === item.icon) ||
            typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color) || typeof item.active !== 'boolean') {
            throw new Error('Kategori adı, simgesi ve rengi geçerli olmalıdır. Ad en fazla 40 karakter olabilir.');
        }
        const name = item.name.trim().normalize('NFC');
        const folded = name.toLocaleLowerCase('tr-TR');
        if (keys.has(item.key)) throw new Error('Kategori bağlantıları benzersiz olmalıdır.');
        if (item.active && names.has(folded)) throw new Error('Aynı adla iki kategori kullanılamaz.');
        keys.add(item.key);
        if (item.active) names.add(folded);
        return { key: item.key, name, icon: item.icon, color: item.color.toUpperCase(), active: item.active };
    });
}

export const defaultCategorySettings = (): CategorySettings => ({ revision: 0, categories: validateCategories(defaults) });

export function parseCategorySettings(data: unknown): CategorySettings {
    if (data == null) return defaultCategorySettings();
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Kategori ayarları okunamadı.');
    const record = data as Record<string, unknown>;
    if (record.schemaVersion !== 1 || typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 0) {
        throw new Error('Kategori ayarlarının sürümü geçersiz.');
    }
    return { revision: record.revision, categories: validateCategories(record.categories) };
}

export function resolveCategories(categories: readonly PosCategory[], productKeys: Iterable<string>): PosCategory[] {
    const used = new Set(productKeys);
    const result = categories.filter(item => item.active || used.has(item.key)).map(item => ({ ...item }));
    const known = new Set(result.map(item => item.key));
    // Legacy or concurrently assigned categories stay reachable without moving any product.
    for (const key of used) {
        if (known.has(key)) continue;
        known.add(key);
        result.push({ key, name: key.startsWith('cat_') ? 'Diğer ürünler' : key, icon: 'basket', color: '#607D8B', active: true });
    }
    return result;
}

export const categoryName = (categories: readonly PosCategory[], key: string): string =>
    categories.find(item => item.key === key)?.name || (key.startsWith('cat_') ? 'Diğer ürünler' : key);
