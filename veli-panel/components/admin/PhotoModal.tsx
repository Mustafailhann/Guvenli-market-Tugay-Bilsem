'use client';

import { useEffect, useState } from 'react';
import { auth } from '@/lib/firebase';

interface PhotoModalProps {
    isOpen: boolean;
    onClose: () => void;
    photoPath: string;
    saleId?: string;
    timestamp?: string;
    deviceName?: string;
}

export default function PhotoModal({
    isOpen,
    onClose,
    photoPath,
    saleId,
    timestamp,
    deviceName = "Cihaz: Otomat-1"
}: PhotoModalProps) {
    const [photoUrl, setPhotoUrl] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        let objectUrl: string | null = null;

        const loadPhoto = async () => {
            if (!isOpen || !photoPath) {
                setPhotoUrl(null);
                setError('');
                setLoading(false);
                return;
            }

            setPhotoUrl(null);
            setLoading(true);
            setError('');

            const id = saleId || /\/([A-Za-z0-9_-]+)\.jpg$/.exec(photoPath)?.[1];
            if (!id) {
                setError('Bu işlemin fotoğraf kimliği bulunamadı.');
                setLoading(false);
                return;
            }

            try {
                const user = auth.currentUser;
                if (!user) throw new Error('Fotoğraf için yeniden giriş yapın.');
                const token = await user.getIdToken();
                const response = await fetch(`/api/image?saleId=${encodeURIComponent(id)}`, {
                    headers: { Authorization: `Bearer ${token}` },
                    cache: 'no-store',
                });
                if (!response.ok) {
                    throw new Error(response.status === 404
                        ? 'Fotoğraf henüz yüklenmedi veya mevcut değil.'
                        : response.status === 403
                            ? 'Bu fotoğrafı görüntüleme yetkiniz yok.'
                            : 'Fotoğraf sunucusuna ulaşılamadı.');
                }
                const blob = await response.blob();
                if (cancelled) return;
                objectUrl = URL.createObjectURL(blob);
                setPhotoUrl(objectUrl);
            } catch (caught) {
                if (!cancelled) setError(caught instanceof Error ? caught.message : 'Fotoğraf yüklenemedi.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void loadPhoto();

        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [isOpen, photoPath, saleId]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
            <div 
                className="bg-white rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col"
                onClick={e => e.stopPropagation()} // modal arkaplanına tıklandığında kapanmasını engellemek için
            >
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                    <div>
                        <h3 className="text-xl font-bold text-gray-900">İşlem Görüntüsü</h3>
                        <p className="text-sm text-gray-500 mt-1">{timestamp || 'Tarih Bilinmiyor'}</p>
                    </div>
                    <button 
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 bg-gray-50 flex-1 flex items-center justify-center min-h-[300px] relative">
                    {loading && !error && (
                        <div className="flex flex-col items-center absolute inset-0 justify-center">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-3"></div>
                            <span className="text-sm text-gray-500">Fotoğraf indiriliyor...</span>
                        </div>
                    )}
                    {error && (
                        <div className="text-center p-6 z-10">
                            <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <p className="text-red-600 font-medium">{error}</p>
                        </div>
                    )}
                    {photoUrl && !error && (
                        <img 
                            src={photoUrl} 
                            alt="İşlem Fotoğrafı" 
                            className="max-h-[60vh] w-auto h-auto rounded-xl object-contain shadow-sm bg-white"
                            onLoad={() => setLoading(false)}
                            onError={() => {
                                setLoading(false);
                                setError("Resim sunucuda bulunamadı veya hata oluştu.");
                            }}
                            style={{ 
                                opacity: loading ? 0 : 1, 
                                position: loading ? 'absolute' : 'relative' 
                            }}
                        />
                    )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
                    <span className="flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        {deviceName}
                    </span>
                    <button
                        onClick={onClose}
                        className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-lg font-medium transition-colors"
                    >
                        Kapat
                    </button>
                </div>
            </div>
        </div>
    );
}
