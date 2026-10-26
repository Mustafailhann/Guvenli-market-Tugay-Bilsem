'use client';

import StockLedger from '@/components/admin/StockLedger';

export default function StockLedgerPage() {
    return (
        <div className="space-y-6 p-6">
            <div>
                <h1 className="text-2xl font-bold text-slate-800 dark:text-white">Stok Defteri</h1>
                <p className="mt-1 text-sm text-slate-500">Ürünlerin tarihli stok giriş ve çıkış kayıtları</p>
            </div>
            <StockLedger />
        </div>
    );
}
