import { NextRequest } from 'next/server';
import { handleSalePhoto } from '@/lib/server/sale-photos';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function PUT(req: NextRequest, context: { params: Promise<{ saleId: string }> }) {
    const { saleId } = await context.params;
    return handleSalePhoto(req, saleId, 'PUT');
}
