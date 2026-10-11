import { useState, type ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth, REVIEWER_ROLES } from '@/lib/auth';
import { rolesForPath } from '@/lib/access';
import { ROLE_LABELS } from '@/lib/format';
import { Badge, Button, cn } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  badge?: 'inbox' | 'registrations';
}

const icon = (path: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
    <path d={path} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Who may see each item comes from PAGE_ROLES, the same map the router gates
// with, so a menu entry can never point at a page the user is bounced from.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'ภาพรวม', icon: icon('M3 12l9-9 9 9M5 10v10h14V10') },
  { to: '/requests', label: 'คำขอ', icon: icon('M8 3h8l4 4v14H4V3h4zM8 3v4h8V3M8 12h8M8 16h5') },
  {
    to: '/inbox',
    label: 'คิวงานของฉัน',
    icon: icon('M3 12h5l2 3h4l2-3h5M3 12l2-7h14l2 7v7H3v-7z'),
    badge: 'inbox',
  },
  { to: '/payments', label: 'การเบิกจ่าย', icon: icon('M3 7h18v11H3V7zm0 4h18M7 15h4') },
  { to: '/budget', label: 'งบประมาณ', icon: icon('M12 3v18M7 7h10M5 12h14M7 17h10') },
  { to: '/reports', label: 'รายงาน', icon: icon('M4 20V10M10 20V4M16 20v-7M22 20H2') },
  {
    to: '/admin/registrations',
    label: 'ใบสมัครสมาชิก',
    icon: icon('M15 19v-1a4 4 0 0 0-8 0v1M11 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 8v6M22 11h-6'),
    badge: 'registrations',
  },
  {
    to: '/admin/users',
    label: 'ผู้ใช้งาน',
    icon: icon('M16 20v-2a4 4 0 0 0-8 0v2M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'),
  },
  { to: '/admin/journal-tiers', label: 'อัตราค่าตอบแทน', icon: icon('M4 6h16M4 12h16M4 18h10') },
];

export function AppLayout() {
  const { user, logout, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const { data: inboxCount } = useQuery({
    queryKey: ['inbox-count'],
    queryFn: () => api.get<{ count: number }>('/approvals/inbox/count'),
    enabled: Boolean(user && user.roles.some((role) => REVIEWER_ROLES.includes(role))),
    refetchInterval: 120_000,
  });

  const { data: registrationCount } = useQuery({
    queryKey: ['registrations-count'],
    queryFn: () => api.get<{ count: number }>('/registrations/count'),
    enabled: can('ADMIN'),
    refetchInterval: 120_000,
  });

  const badgeCount = (badge: NavItem['badge']) =>
    badge === 'inbox'
      ? (inboxCount?.count ?? 0)
      : badge === 'registrations'
        ? (registrationCount?.count ?? 0)
        : 0;

  const visibleItems = NAV_ITEMS.filter((item) => {
    const roles = rolesForPath(item.to);
    return !roles || can(...roles);
  });

  // A reviewer opening "คำขอ" gets every submitted claim, not their own, so the
  // label only says "ของฉัน" for someone who really does see only their own.
  const isPlainRequester = !can(...REVIEWER_ROLES, 'FINANCE', 'ADMIN') && can('RESEARCHER');
  const labelFor = (item: NavItem) =>
    item.to === '/requests' && isPlainRequester ? 'คำขอของฉัน' : item.label;

  const handleLogout = async () => {
    await logout();
    // A full load of the sign-in page rather than an in-app navigation: nothing
    // from this session - cached data, component state - can carry over to
    // whoever signs in next on a shared office computer. `replace` keeps Back
    // from returning to a signed-in page.
    window.location.replace('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white no-print">
        <div className="flex h-14 items-center gap-3 px-4">
          <button
            type="button"
            className="rounded p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
            onClick={() => setMobileOpen((open) => !open)}
            aria-label="เมนู"
          >
            {icon('M4 6h16M4 12h16M4 18h16')}
          </button>

          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
              CP
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">
                ระบบเบิกค่าตอบแทนการตีพิมพ์บทความ
              </p>
              <p className="hidden text-xs text-slate-500 sm:block">มหาวิทยาลัยราชภัฏชัยภูมิ</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-slate-800">{user?.fullName}</p>
              <p className="text-xs text-slate-500">
                {user?.roles.map((role) => ROLE_LABELS[role]).join(' · ')}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              ออกจากระบบ
            </Button>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar */}
        <aside
          className={cn(
            'fixed inset-y-14 left-0 z-30 w-64 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-3 transition-transform no-print',
            'lg:sticky lg:top-14 lg:h-[calc(100vh-3.5rem)] lg:translate-x-0',
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <nav className="flex flex-col gap-0.5">
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
                    isActive
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                  )
                }
              >
                <span className="shrink-0 text-current">{item.icon}</span>
                <span className="flex-1">{labelFor(item)}</span>
                {badgeCount(item.badge) > 0 && (
                  <Badge className="bg-rose-100 text-rose-700 ring-rose-200">
                    {badgeCount(item.badge)}
                  </Badge>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="mt-6 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-500">
            <p className="font-medium text-slate-700">อ้างอิงหลักเกณฑ์</p>
            <p className="mt-1">
              ประกาศมหาวิทยาลัยราชภัฏชัยภูมิ เลขที่ 2131/2566 และแบบฟอร์ม CPRU-RDI-F011
            </p>
          </div>
        </aside>

        {mobileOpen && (
          <div
            className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
            onClick={() => setMobileOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mx-auto max-w-6xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
