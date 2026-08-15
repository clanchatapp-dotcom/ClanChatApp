'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { Toaster } from '@/components/ui/sonner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Router guard: force the profile-completion page while a profile is pending.
function AuthGate({ children }) {
  const { pendingProfile, loading } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (pendingProfile && pathname !== '/complete-profile') {
      router.replace('/complete-profile');
    } else if (!pendingProfile && pathname === '/complete-profile') {
      router.replace('/');
    }
  }, [pendingProfile, pathname, loading, router]);

  return children;
}

export function Providers({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthGate>{children}</AuthGate>
        <Toaster position="top-center" theme="dark" richColors />
      </AuthProvider>
    </QueryClientProvider>
  );
}
