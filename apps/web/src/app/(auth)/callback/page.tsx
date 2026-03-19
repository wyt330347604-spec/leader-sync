'use client';
import { useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api-client';

function CallbackContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const code = searchParams.get('code');
    const redirect = searchParams.get('redirect') || '/tasks';

    if (!code) {
      router.push('/tasks');
      return;
    }

    apiFetch('/api/v1/auth/feishu/jsapi-auth', {
      method: 'POST',
      body: JSON.stringify({ code }),
    })
      .then(() => router.push(redirect))
      .catch(() => router.push('/tasks'));
  }, [searchParams, router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p className="text-gray-500">登录中...</p>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <p className="text-gray-500">加载中...</p>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
