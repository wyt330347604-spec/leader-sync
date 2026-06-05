'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-client';
import { AiChatWidget } from './index';

interface AuthMeResponse {
  user_id: string;
  role: string;
  user_name: string;
}

/**
 * AiChatProvider — client-side wrapper that fetches the current user role
 * and renders AiChatWidget only for leader/boss/pmo/admin roles.
 *
 * Mounted at the root layout; uses a single /auth/me call (already cached by
 * browser on other pages that also call it).
 */
export function AiChatProvider() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AuthMeResponse>('/api/v1/auth/me')
      .then((user) => setRole(user.role))
      .catch(() => {
        // Unauthenticated or API unavailable — silently skip widget
        setRole(null);
      });
  }, []);

  if (!role) return null;

  return <AiChatWidget role={role} />;
}
