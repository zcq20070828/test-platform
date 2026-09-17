// SSO (Keycloak OIDC) 统一认证 API
import type { ApiResponse } from '@/types'
import { request } from './index'

export interface SsoConfig {
  enabled: boolean
  authEndpoint: string | null
  clientId: string | null
  realm: string | null
  baseUrl: string | null
}

export interface SsoLoginUrlResponse {
  loginUrl: string
  state: string
}

export interface SsoCallbackResponse {
  token: string
  refreshToken: string
  user: {
    id: string
    username: string
    name: string
    role: string
    authSource: 'keycloak'
  }
}

export interface RefreshTokenResponse {
  token: string
  expiresIn: number
}

export const ssoApi = {
  // 获取 SSO 配置
  async getConfig(): Promise<SsoConfig | null> {
    const res = await request<SsoConfig>('/api/sso/config')
    return res.success ? res.data! : null
  },

  // 获取 SSO 登录 URL
  async getLoginUrl(): Promise<SsoLoginUrlResponse | null> {
    const res = await request<SsoLoginUrlResponse>('/api/sso/login-url')
    return res.success ? res.data! : null
  },

  // SSO 回调处理
  async callback(code: string, state: string, redirectUri?: string): Promise<SsoCallbackResponse | null> {
    const res = await request<SsoCallbackResponse>('/api/sso/callback', {
      method: 'POST',
      body: JSON.stringify({ code, state, redirectUri })
    })
    return res.success ? res.data! : null
  },

  // 刷新 Token
  async refreshToken(refreshToken: string): Promise<RefreshTokenResponse | null> {
    const res = await request<RefreshTokenResponse>('/api/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken })
    })
    return res.success ? res.data! : null
  },

  // SSO 退出
  async ssoLogout(): Promise<{ redirectUrl: string | null } | null> {
    const res = await request<{ redirectUrl: string | null }>('/api/sso/logout', {
      method: 'POST'
    })
    return res.success ? res.data! : null
  }
}
