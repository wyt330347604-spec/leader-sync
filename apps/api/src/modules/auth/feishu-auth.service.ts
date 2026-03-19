import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface FeishuUserInfo {
  user_id: string;
  open_id: string;
  name: string;
  department_ids?: string[];
}

interface FeishuAppTokenResponse {
  code: number;
  msg: string;
  app_access_token: string;
  expire: number;
}

interface FeishuUserTokenResponse {
  code: number;
  msg: string;
  data: { access_token: string };
}

interface FeishuUserInfoResponse {
  code: number;
  msg: string;
  data: {
    user_id: string;
    open_id: string;
    name: string;
    department_ids?: string[];
  };
}

@Injectable()
export class FeishuAuthService {
  private appAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: ConfigService) {}

  private get appId(): string {
    return this.config.getOrThrow<string>('FEISHU_APP_ID');
  }

  private get appSecret(): string {
    return this.config.getOrThrow<string>('FEISHU_APP_SECRET');
  }

  async getAppAccessToken(): Promise<string> {
    if (this.appAccessToken && Date.now() < this.tokenExpiresAt) {
      return this.appAccessToken;
    }

    const res = await fetch(
      'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: this.appId,
          app_secret: this.appSecret,
        }),
      },
    );
    const data = (await res.json()) as FeishuAppTokenResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to get app_access_token: ${data.msg}`);
    }
    this.appAccessToken = data.app_access_token;
    this.tokenExpiresAt = Date.now() + (data.expire - 300) * 1000; // refresh 5min early
    return this.appAccessToken!;
  }

  async getUserAccessToken(code: string): Promise<string> {
    const appToken = await this.getAppAccessToken();
    const res = await fetch(
      'https://open.feishu.cn/open-apis/authen/v1/oidc/access_token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${appToken}`,
        },
        body: JSON.stringify({ grant_type: 'authorization_code', code }),
      },
    );
    const data = (await res.json()) as FeishuUserTokenResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to get user_access_token: ${data.msg}`);
    }
    return data.data.access_token;
  }

  async getUserInfo(userAccessToken: string): Promise<FeishuUserInfo> {
    const res = await fetch(
      'https://open.feishu.cn/open-apis/authen/v1/user_info',
      {
        headers: { Authorization: `Bearer ${userAccessToken}` },
      },
    );
    const data = (await res.json()) as FeishuUserInfoResponse;
    if (data.code !== 0) {
      throw new Error(`Failed to get user info: ${data.msg}`);
    }
    return {
      user_id: data.data.user_id,
      open_id: data.data.open_id,
      name: data.data.name,
      department_ids: data.data.department_ids,
    };
  }

  getOAuthRedirectUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      app_id: this.appId,
      redirect_uri: redirectUri,
      state: state || '',
    });
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?${params}`;
  }
}
