import type { ApiResponse } from '@leader-sync/shared-types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public traceId: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });
  } catch {
    // 网络层失败（断网 / API 完全不可达）
    throw new ApiError(-1, '网络连接失败，请检查网络后重试', '');
  }

  // API 502/重启时 nginx 会返回 HTML 而非 JSON —— 无条件 res.json() 会抛
  // SyntaxError 导致页面白屏（不是 ApiError）。先按状态码/内容类型兜底。
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('application/json')) {
    if (res.status === 401 || res.status === 403) {
      throw new ApiError(1002, '未登录或无权限', '');
    }
    throw new ApiError(res.status || -1, '服务暂时不可用，请稍后重试', '');
  }

  let json: ApiResponse<T>;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(-1, '服务返回异常，请稍后重试', '');
  }

  if (json.code !== 0) {
    throw new ApiError(json.code, json.message, json.trace_id);
  }

  return json.data;
}
