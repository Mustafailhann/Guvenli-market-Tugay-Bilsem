import { NextRequest, NextResponse } from 'next/server';

const SALE_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export async function GET(req: NextRequest) {
    const saleId = new URL(req.url).searchParams.get('saleId');
    if (!saleId || !SALE_ID_PATTERN.test(saleId)) {
        return new NextResponse('Geçersiz satış kimliği.', { status: 400 });
    }
    const token = /^Bearer (\S+)$/i.exec(req.headers.get('authorization') || '')?.[1];
    if (!token) return new NextResponse('Oturum gerekli.', { status: 401 });
    const origin = process.env.PHOTO_SERVER_URL;
    if (!origin || !origin.startsWith('https://')) {
        return new NextResponse('Fotoğraf sunucusu henüz yapılandırılmadı.', { status: 503 });
    }

    try {
        const response = await fetch(`${origin.replace(/\/$/, '')}/photos/${saleId}`, {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(12000),
        });
        if (!response.ok) {
            return new NextResponse(response.status === 404
                ? 'Fotoğraf henüz yüklenmedi.'
                : 'Fotoğraf görüntülenemedi.', { status: response.status });
        }
        if (response.headers.get('content-type') !== 'image/jpeg') {
            return new NextResponse('Geçersiz görsel yanıtı.', { status: 502 });
        }
        return new NextResponse(response.body, {
            status: 200,
            headers: {
                'Content-Type': 'image/jpeg',
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error) {
        console.error('Fotoğraf sunucusuna ulaşılamadı:', error);
        return new NextResponse('Fotoğraf sunucusuna ulaşılamadı.', { status: 502 });
    }
}
