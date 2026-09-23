import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, SESSION_EXPIRED_EVENT } from './api';
import { useToast } from '@/components/ui';
import type { AuthUser, Quota, RoleCode } from '@/types';

/**
 * Every tab of one browser shares one session cookie, so a sign-in or sign-out
 * in one tab changes who every other tab is acting as. The channel tells the
 * other tabs straight away, instead of leaving them showing the old identity
 * while their requests quietly run as someone else - or not at all.
 */
const AUTH_CHANNEL = 'cpru-auth';
type AuthSignal = { type: 'login' | 'logout' };

interface Session {
  user: AuthUser;
  quota: Quota;
}

interface AuthContextValue {
  user: AuthUser | null;
  quota: Quota | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** True when the user holds any of the given roles. */
  can: (...roles: RoleCode[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<Session | null> => {
      try {
        return await api.get<Session>('/auth/me');
      } catch (error) {
        // 401 simply means nobody is signed in yet.
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });

  const toast = useToast();
  const channelRef = useRef<BroadcastChannel | null>(null);

  /**
   * Drops everything cached for the previous identity and asks the server who
   * this browser is now. A 401 comes back as a null session, and RequireAuth
   * then sends the page to /login.
   */
  const resync = useCallback(async () => {
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  useEffect(() => {
    // Not in every browser; the SESSION_EXPIRED_EVENT below still covers those,
    // just on the next request instead of immediately.
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(AUTH_CHANNEL);
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<AuthSignal>) => {
      if (event.data?.type === 'logout') {
        toast.push('info', 'ออกจากระบบแล้ว เนื่องจากมีการออกจากระบบในแท็บอื่นของเบราว์เซอร์นี้');
      }
      void resync();
    };
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [resync, toast]);

  useEffect(() => {
    const onExpired = () => void resync();
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [resync]);

  // BroadcastChannel never delivers to the sender, so the acting tab does not
  // resync itself on top of what login/logout already did.
  const broadcast = useCallback(
    (type: AuthSignal['type']) => channelRef.current?.postMessage({ type }),
    [],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      await api.post('/auth/login', { username, password });
      // Nothing cached for a previous identity may survive into the new one.
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
      await queryClient.invalidateQueries({ queryKey: ['session'] });
      broadcast('login');
    },
    [queryClient, broadcast],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Already signed out - most often by another tab. The button must still
      // work: the local session is cleared either way.
    }
    // Session first. The provider's observer is subscribed to this very query,
    // so it re-renders with no user at once. Clearing the whole cache first used
    // to destroy the query out from under the observer, leaving the old user in
    // context - /login then saw someone signed in and bounced to the dashboard.
    queryClient.setQueryData(['session'], null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
    broadcast('logout');
  }, [queryClient, broadcast]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['session'] });
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const user = data?.user ?? null;
    return {
      user,
      quota: data?.quota ?? null,
      loading: isLoading,
      login,
      logout,
      refresh,
      can: (...roles: RoleCode[]) => Boolean(user && user.roles.some((role) => roles.includes(role))),
    };
  }, [data, isLoading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}

/** Roles that get a review queue, used to decide which nav items appear. */
export const REVIEWER_ROLES: RoleCode[] = [
  'FACULTY_QA',
  'DEAN',
  'RDI_OFFICER',
  'ACADEMIC_OFFICE',
  'APPROVER',
];
