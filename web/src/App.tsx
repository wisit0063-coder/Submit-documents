import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { AppLayout } from '@/layouts/AppLayout';
import { Spinner } from '@/components/ui';
import { LoginPage } from '@/pages/LoginPage';
import { ForgotPasswordPage, ResetPasswordPage } from '@/pages/PasswordPages';
import { ChangePasswordPage } from '@/pages/ChangePasswordPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { RequestListPage } from '@/pages/RequestListPage';
import { RequestFormPage } from '@/pages/RequestFormPage';
import { RequestDetailPage } from '@/pages/RequestDetailPage';
import { InboxPage } from '@/pages/InboxPage';
import { PaymentsPage } from '@/pages/PaymentsPage';
import { BudgetPage } from '@/pages/BudgetPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AdminPositionsPage } from '@/pages/AdminPositionsPage';
import { AdminTiersPage } from '@/pages/AdminTiersPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { AdminRegistrationsPage } from '@/pages/AdminRegistrationsPage';
import { ForbiddenPage, NotFoundPage } from '@/pages/NotFoundPage';
import { rolesForPath } from '@/lib/access';

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner className="h-8 w-8 text-brand-600" />
    </div>
  );
}

/**
 * Everything inside the app requires a session. A first login is also forced
 * through the change-password screen before anything else is reachable.
 */
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

/**
 * Role gate for a single page, reading the same map the sidebar uses. Without
 * it a signed-in user could type any address and land on a page whose every
 * request then failed with a permission error.
 */
function RequireRoles({ path, children }: { path: string; children: JSX.Element }) {
  const { can } = useAuth();
  const roles = rolesForPath(path);
  if (roles && !can(...roles)) return <ForbiddenPage />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <FullPageSpinner />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="/change-password"
        element={
          <RequireAuth>
            <ChangePasswordPage />
          </RequireAuth>
        }
      />

      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/requests" element={<RequestListPage />} />
        <Route
          path="/requests/new"
          element={
            <RequireRoles path="/requests/new">
              <RequestFormPage />
            </RequireRoles>
          }
        />
        <Route path="/requests/:id/edit" element={<RequestFormPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route
          path="/inbox"
          element={
            <RequireRoles path="/inbox">
              <InboxPage />
            </RequireRoles>
          }
        />
        <Route
          path="/payments"
          element={
            <RequireRoles path="/payments">
              <PaymentsPage />
            </RequireRoles>
          }
        />
        <Route
          path="/budget"
          element={
            <RequireRoles path="/budget">
              <BudgetPage />
            </RequireRoles>
          }
        />
        <Route
          path="/reports"
          element={
            <RequireRoles path="/reports">
              <ReportsPage />
            </RequireRoles>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequireRoles path="/admin/users">
              <AdminUsersPage />
            </RequireRoles>
          }
        />
        <Route
          path="/admin/positions"
          element={
            <RequireRoles path="/admin/positions">
              <AdminPositionsPage />
            </RequireRoles>
          }
        />
        <Route
          path="/admin/journal-tiers"
          element={
            <RequireRoles path="/admin/journal-tiers">
              <AdminTiersPage />
            </RequireRoles>
          }
        />
        <Route
          path="/admin/registrations"
          element={
            <RequireRoles path="/admin/registrations">
              <AdminRegistrationsPage />
            </RequireRoles>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
