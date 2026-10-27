'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onIdTokenChanged } from 'firebase/auth';
import AdminSidebar from '@/components/admin/AdminSidebar';
import { auth } from '@/lib/firebase';
import { adminAccessFromClaims, canAccessAdminPath, type AdminAccess } from '@/lib/admin-access';

type AdminSession =
    | { status: 'loading' | 'signed-out' | 'error' }
    | { status: 'ready'; access: AdminAccess };

export default function AdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();
    const [session, setSession] = useState<AdminSession>({ status: 'loading' });

    useEffect(() => {
        let active = true;
        let revision = 0;
        const unsubscribe = onIdTokenChanged(auth, async user => {
            if (!active) return;
            const currentRevision = ++revision;
            setSession({ status: 'loading' });
            if (!user) {
                setSession({ status: 'signed-out' });
                return;
            }
            try {
                const token = await user.getIdTokenResult();
                if (active && currentRevision === revision) {
                    setSession({ status: 'ready', access: adminAccessFromClaims(token.claims) });
                }
            } catch {
                if (active && currentRevision === revision) setSession({ status: 'error' });
            }
        }, () => {
            if (!active) return;
            revision++;
            setSession({ status: 'error' });
        });
        return () => { active = false; revision++; unsubscribe(); };
    }, []);

    useEffect(() => {
        if (session.status === 'signed-out') router.replace('/giris');
        if (session.status !== 'ready') return;
        if (!session.access.isAdmin) router.replace('/dashboard');
        else if (!canAccessAdminPath(pathname, session.access)) router.replace('/admin');
    }, [session, pathname, router]);

    if (session.status === 'error') {
        return <div role="alert" className="p-8 text-red-600">Oturum yetkisi doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.</div>;
    }
    if (session.status !== 'ready' || !session.access.isAdmin) {
        return <p role="status" className="p-8 text-slate-500">Oturum kontrol ediliyor…</p>;
    }

    return (
        <div className="min-h-screen bg-gray-50 flex">
            <AdminSidebar access={session.access} />
            <div className="flex-1 ml-64">
                {canAccessAdminPath(pathname, session.access) ? children : (
                    <p role="status" className="p-8 text-slate-500">Yönlendiriliyor…</p>
                )}
            </div>
        </div>
    );
}
