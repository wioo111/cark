import { Capacitor } from '@capacitor/core'

const SERVER_URL_KEY = 'cark-mobile-server-url'

export function normalizeServerUrl(value: string) {
  return value.trim().replace(/\/+$/, '')
}

export function getApiBaseUrl() {
  if (typeof localStorage === 'undefined') return ''
  return normalizeServerUrl(localStorage.getItem(SERVER_URL_KEY) ?? '')
}

export function setApiBaseUrl(value: string) {
  const normalized = normalizeServerUrl(value)
  if (typeof localStorage === 'undefined') return
  if (normalized) localStorage.setItem(SERVER_URL_KEY, normalized)
  else localStorage.removeItem(SERVER_URL_KEY)
}

export function isNativeOfflineMode() {
  return Capacitor.isNativePlatform() && !getApiBaseUrl()
}

export function withApiBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (typeof input !== 'string' || !input.startsWith('/api/')) return input
  const baseUrl = getApiBaseUrl()
  return baseUrl ? `${baseUrl}${input}` : input
}
