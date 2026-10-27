import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function load(relativePath, mocks = {}) {
    const filename = path.join(root, relativePath);
    const javascript = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const subject = new Module(filename);
    subject.filename = filename;
    subject.paths = Module._nodeModulePaths(path.dirname(filename));
    subject.require = specifier => Object.hasOwn(mocks, specifier)
        ? mocks[specifier] : Module.prototype.require.call(subject, specifier);
    subject._compile(javascript, filename);
    return subject.exports;
}

const policy = load('lib/admin-access.ts');
const { adminAccessFromClaims, canAccessAdminPath } = policy;
const owner = adminAccessFromClaims({ admin: true, email: '5550000000@okul.local' });
const otherAdmin = adminAccessFromClaims({ admin: true, email: '5551234567@okul.local' });
const restricted = ['/admin/analitik', '/admin/finans', '/admin/veri-yukle', '/admin/kart-yukle', '/admin/bakim'];
const shared = ['/admin', '/admin/ogrenciler', '/admin/personeller', '/admin/veliler', '/admin/harcamalar', '/admin/urunler', '/admin/stok-defteri', '/admin/ayarlar'];

test('yalnız doğru Firebase hesabı ve gerçek admin yetkisi özel bölümleri açar', () => {
    assert.deepEqual(owner, { isAdmin: true, isOwner: true });
    assert.deepEqual(otherAdmin, { isAdmin: true, isOwner: false });
    for (const claims of [undefined, null, {}, { email: '5550000000@okul.local' },
        { admin: 'true', email: '5550000000@okul.local' },
        { admin: false, email: '5550000000@okul.local' }]) {
        const access = adminAccessFromClaims(claims);
        assert.equal(access.isOwner, false);
        for (const route of [...restricted, ...shared]) assert.equal(canAccessAdminPath(route, access), false);
    }
    for (const email of ['5550000000@example.com', '5550000000@okul.local.example.com', '05550000000@okul.local', '55500000000@okul.local']) {
        assert.equal(adminAccessFromClaims({ admin: true, email }).isOwner, false);
    }
    assert.equal(adminAccessFromClaims({ admin: true, email: '5551234567@okul.local', telefonNo: '5550000000', role: 'admin' }).isOwner, false);
});

test('diğer yönetici beş sayfaya ve alt adreslerine giremez; diğer bölümler açık kalır', () => {
    for (const route of restricted) {
        for (const pathname of [route, `${route}/`, `${route}/detay`]) {
            assert.equal(canAccessAdminPath(pathname, otherAdmin), false, pathname);
            assert.equal(canAccessAdminPath(pathname, owner), true, pathname);
        }
    }
    for (const route of shared) {
        assert.equal(canAccessAdminPath(route, otherAdmin), true, route);
        assert.equal(canAccessAdminPath(route, owner), true, route);
    }
});

const navigation = { usePathname: () => '/admin/urunler', useRouter: () => ({ push() {}, replace() {} }) };
const Sidebar = load('components/admin/AdminSidebar.tsx', {
    'next/navigation': navigation,
    'next/link': ({ href, children, ...props }) => React.createElement('a', { ...props, href }, children),
    '@/lib/auth': { signOut: async () => ({ success: true }) },
    '@/lib/admin-access': policy,
}).default;

test('gerçek sidebar diğer yöneticide beş bağlantıyı gizler, 5550000000 hesabında gösterir', () => {
    const ordinaryMenu = renderToStaticMarkup(React.createElement(Sidebar, { access: otherAdmin }));
    const ownerMenu = renderToStaticMarkup(React.createElement(Sidebar, { access: owner }));
    for (const href of restricted) {
        assert.equal(ordinaryMenu.includes(`href="${href}"`), false, href);
        assert.equal(ownerMenu.includes(`href="${href}"`), true, href);
    }
    for (const href of shared) assert.equal(ordinaryMenu.includes(`href="${href}"`), true, href);
});

test('oturum doğrulanmadan sayfa içeriği ve menü render edilmez', () => {
    const Layout = load('app/admin/layout.tsx', {
        'next/navigation': navigation,
        'firebase/auth': { onIdTokenChanged() { throw new Error('SSR oturum dinleyicisi başlatmamalı'); } },
        '@/components/admin/AdminSidebar': Sidebar,
        '@/lib/firebase': { auth: {} },
        '@/lib/admin-access': policy,
    }).default;
    let mounted = false;
    function PrivatePage() { mounted = true; return React.createElement('p', null, 'Gizli sayfa içeriği'); }
    const html = renderToStaticMarkup(React.createElement(Layout, null, React.createElement(PrivatePage)));
    assert.equal(mounted, false);
    assert.equal(html.includes('Gizli sayfa içeriği'), false);
    assert.equal(html.includes('href="/admin/finans"'), false);
    assert.ok(html.includes('Oturum kontrol ediliyor'));
});
