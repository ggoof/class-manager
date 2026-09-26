import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthResponse, PublicUser, Role } from '@cm/shared';
import { api, getToken, setToken } from './api';

/** Fields a new student supplies when registering themselves. */
export interface RegisterInput {
  username: string;
  password: string;
  realName: string;
  email: string;
  age?: number | null;
  phone?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
}

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<PublicUser>;
  register: (input: RegisterInput) => Promise<PublicUser>;
  signOut: () => void;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<PublicUser>('/api/auth/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      async signIn(username, password) {
        const res = await api.post<AuthResponse>('/api/auth/login', { username, password });
        setToken(res.token);
        setUser(res.user);
        return res.user;
      },
      async register(input) {
        const res = await api.post<AuthResponse>('/api/auth/register', input);
        setToken(res.token);
        setUser(res.user);
        return res.user;
      },
      signOut() {
        setToken(null);
        setUser(null);
      },
      async refresh() {
        setUser(await api.get<PublicUser>('/api/auth/me'));
      },
    }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where each role lands after signing in. */
export const homeFor: Record<Role, string> = {
  ADMIN: '/admin',
  TEACHER: '/teacher',
  STUDENT: '/student',
};
