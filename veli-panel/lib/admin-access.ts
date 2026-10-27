export interface AdminAccess {
    isAdmin: boolean;
    isOwner: boolean;
}

const ownerOnlyPaths = [
    '/admin/analitik',
    '/admin/finans',
    '/admin/veri-yukle',
    '/admin/kart-yukle',
    '/admin/bakim',
];

// Telefon/rol gibi düzenlenebilir profil alanları yerine Firebase oturumunu kullan.
export function adminAccessFromClaims(claims?: Record<string, unknown> | null): AdminAccess {
    const isAdmin = claims?.admin === true;
    return { isAdmin, isOwner: isAdmin && claims?.email === '5550000000@okul.local' };
}

export function canAccessAdminPath(pathname: string, access: AdminAccess): boolean {
    return access.isAdmin && (access.isOwner || !ownerOnlyPaths.some(path =>
        pathname === path || pathname.startsWith(`${path}/`),
    ));
}
