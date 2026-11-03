import { NextRequest } from 'next/server';
import { handleSalePhoto } from '@/lib/server/sale-photos';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
    return handleSalePhoto(req, new URL(req.url).searchParams.get('saleId'), 'GET');
}
