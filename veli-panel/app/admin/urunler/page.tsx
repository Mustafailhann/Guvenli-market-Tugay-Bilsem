'use client';

import { useState, useEffect } from 'react';
import { getProducts, addProduct, updateProductWithStockLedger, deleteProduct, uploadProductImage } from '@/lib/products';
import { Urun } from '@/types';
import * as XLSX from 'xlsx';

export default function ProductsPage() {
    const [products, setProducts] = useState<Urun[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProduct, setEditingProduct] = useState<Urun | null>(null);

    // Form states
    const [name, setName] = useState('');
    const [price, setPrice] = useState('');
    const [category, setCategory] = useState('Diğer');
    const [stock, setStock] = useState('');
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imageUrlInput, setImageUrlInput] = useState(''); // New state
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [uploading, setUploading] = useState(false);

    const categories = ['İçecekler', 'Atıştırmalıklar', 'Tatlılar', 'Gofretler', 'Kekler', 'Krakerler', 'Çikolatalar', 'Diğer'];

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        setLoading(true);
        const data = await getProducts();
        setProducts(data);
        setLoading(false);
    };

    const handleOpenModal = (product?: Urun) => {
        if (product) {
            setEditingProduct(product);
            setName(product.ad);
            setPrice(product.fiyat.toString());
            setCategory(product.kategori || 'Diğer');
            setStock(product.stok.toString());
            setImageUrlInput(product.resimURL || ''); // Load existing URL
            setImagePreview(product.resimURL || null);
        } else {
            setEditingProduct(null);
            setName('');
            setPrice('');
            setCategory('Diğer');
            setStock('0');
            setImageUrlInput('');
            setImagePreview(null);
        }
        setImageFile(null);
        setIsModalOpen(true);
    };

    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImageFile(file);
            setImageUrlInput(''); // Clear URL input if file selected
            const reader = new FileReader();
            reader.onloadend = () => {
                setImagePreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const url = e.target.value;
        setImageUrlInput(url);
        setImageFile(null); // Clear file if URL typed
        setImagePreview(url);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setUploading(true);

        try {
            let imageURL = editingProduct?.resimURL || '';

            if (imageFile) {
                const url = await uploadProductImage(imageFile);
                if (url) {
                    imageURL = url;
                }
            } else if (imageUrlInput) {
                imageURL = imageUrlInput;
            }

            const productData = {
                ad: name,
                fiyat: parseFloat(price),
                kategori: category,
                stok: parseInt(stock),
                resimURL: imageURL,
            };

            if (editingProduct) {
                const result = await updateProductWithStockLedger(editingProduct.id, productData);
                if (!result.success) throw new Error(result.error);
            } else {
                const result = await addProduct(productData);
                if (!result.success) throw new Error(result.error);
            }

            setIsModalOpen(false);
            fetchProducts();
        } catch (error) {
            console.error('Error saving product:', error);
            alert('Ürün kaydedilirken bir hata oluştu.');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (confirm('Bu ürünü silmek istediğinize emin misiniz?')) {
            await deleteProduct(id);
            fetchProducts();
        }
    };

    const filteredProducts = products.filter(p =>
        p.ad.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const exportStockExcel = () => {
        const data = products.map(p => ({
            'Ürün Adı': p.ad,
            'Kategori': p.kategori || '-',
            'Fiyat (₺)': p.fiyat,
            'Stok Adedi': p.stok,
            'Durum': p.stok <= 15 ? '⚠️ Düşük Stok' : '✅ Normal'
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Stok Durumu');
        ws['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 12 }, { wch: 12 }, { wch: 16 }];
        XLSX.writeFile(wb, `Stok_Durumu_${new Date().toLocaleDateString('tr-TR')}.xlsx`);
    };

    return (
        <div className="p-6">
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-bold text-gray-800">Ürün Yönetimi</h1>
                <div className="flex gap-3">
                    <button
                        onClick={exportStockExcel}
                        className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        Stok Excel
                    </button>
                    <button
                        onClick={() => handleOpenModal()}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors flex items-center gap-2"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                        </svg>
                        Yeni Ürün Ekle
                    </button>
                </div>
            </div>

            <div className="mb-6">
                <div className="relative">
                    <input
                        type="text"
                        placeholder="Ürün ara..."
                        className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="absolute left-3 top-2.5 text-gray-400">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                        </svg>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                    {filteredProducts.map((product) => (
                        <div key={product.id} className="bg-white rounded-lg shadow-md overflow-hidden border border-gray-100 hover:shadow-lg transition-shadow">
                            <div className="h-48 bg-gray-100 relative group">
                                {product.resimURL ? (
                                    <img
                                        src={product.resimURL}
                                        alt={product.ad}
                                        className="w-full h-full object-contain p-4"
                                    />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                        </svg>
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100 gap-2">
                                    <button
                                        onClick={() => handleOpenModal(product)}
                                        className="bg-white p-2 rounded-full text-indigo-600 hover:text-indigo-800"
                                        title="Düzenle"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                        </svg>
                                    </button>
                                    <button
                                        onClick={() => handleDelete(product.id)}
                                        className="bg-white p-2 rounded-full text-red-600 hover:text-red-800"
                                        title="Sil"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div className="p-4">
                                <div className="flex justify-between items-start mb-2">
                                    <h3 className="text-lg font-semibold text-gray-800 truncate" title={product.ad}>{product.ad}</h3>
                                    <span className="bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full whitespace-nowrap">{product.kategori}</span>
                                </div>
                                <div className="flex justify-between items-center mt-2">
                                    <span className="text-xl font-bold text-indigo-600">{product.fiyat.toFixed(2)} ₺</span>
                                    <span className={`text-sm font-semibold ${product.stok === 0 ? 'text-red-600' : product.stok <= 15 ? 'text-orange-500' : 'text-green-600'}`}>
                                        {product.stok === 0 ? 'Stok Yok' : product.stok <= 15 ? `⚠️ ${product.stok} Adet` : `${product.stok} Adet`}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h2 className="text-2xl font-bold mb-4 text-gray-800">
                                {editingProduct ? 'Ürünü Düzenle' : 'Yeni Ürün Ekle'}
                            </h2>
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Ürün Adı</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Fiyat (₺)</label>
                                        <input
                                            type="number"
                                            required
                                            step="0.01"
                                            min="0"
                                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            value={price}
                                            onChange={(e) => setPrice(e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-gray-700 mb-1">Stok</label>
                                        <input
                                            type="number"
                                            required
                                            min="0"
                                            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                            value={stock}
                                            onChange={(e) => setStock(e.target.value)}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Kategori</label>
                                    <select
                                        className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={category}
                                        onChange={(e) => setCategory(e.target.value)}
                                    >
                                        {categories.map(cat => (
                                            <option key={cat} value={cat}>{cat}</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Ürün Görseli</label>

                                    {/* URL Input Option */}
                                    <div className="mb-2">
                                        <input
                                            type="text"
                                            placeholder="Görsel URL (https://...)"
                                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                                            value={imageUrlInput}
                                            onChange={handleUrlChange}
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className="h-px bg-gray-200 flex-1"></div>
                                        <span className="text-xs text-gray-400">VEYA YÜKLE</span>
                                        <div className="h-px bg-gray-200 flex-1"></div>
                                    </div>

                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-indigo-500 transition-colors relative">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            onChange={handleImageChange}
                                        />
                                        {imagePreview ? (
                                            <div className="relative h-40">
                                                <img
                                                    src={imagePreview}
                                                    alt="Preview"
                                                    className="h-full w-full object-contain"
                                                />
                                            </div>
                                        ) : (
                                            <div className="text-gray-500">
                                                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                                </svg>
                                                <span>Görsel seçmek için tıklayın</span>
                                                <p className="text-xs mt-1">PNG, JPG (Max 5MB)</p>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-3 mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setIsModalOpen(false)}
                                        className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                                        disabled={uploading}
                                    >
                                        İptal
                                    </button>
                                    <button
                                        type="submit"
                                        className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:bg-indigo-400 flex justify-center items-center"
                                        disabled={uploading}
                                    >
                                        {uploading ? (
                                            <>
                                                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                </svg>
                                                Kaydediliyor...
                                            </>
                                        ) : (
                                            'Kaydet'
                                        )}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
