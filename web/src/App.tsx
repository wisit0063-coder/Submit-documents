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
import { AdminTiersPage } from '@/pages/AdminTiersPage';
import { RegisterPage } from '@/pages/RegisterPage';
import { AdminRegistrationsPage } from '@/pages/AdminRegistrationsPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

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
        <Route path="/requests/new" element={<RequestFormPage />} />
        <Route path="/requests/:id/edit" element={<RequestFormPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/payments" element={<PaymentsPage />} />
        <Route path="/budget" element={<BudgetPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/admin/journal-tiers" element={<AdminTiersPage />} />
        <Route path="/admin/registrations" element={<AdminRegistrationsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
