// @vitest-environment jsdom

import { Capacitor } from '@capacitor/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getApiBaseUrl, isNativeOfflineMode, normalizeServerUrl, setApiBaseUrl, withApiBaseUrl } from '@/utils/apiBase'

describe('mobile API base URL', () => {
  beforeEach(() => window.localStorage.clear())

  it('normalizes and applies the configured server to API routes', () => {
    setApiBaseUrl('https://cark.example.ts.net///')
    expect(getApiBaseUrl()).toBe('https://cark.example.ts.net')
    expect(withApiBaseUrl('/api/papers')).toBe('https://cark.example.ts.net/api/papers')
  })

  it('does not rewrite non-API resources', () => {
    setApiBaseUrl('https://cark.example.ts.net')
    expect(withApiBaseUrl('/icon.svg')).toBe('/icon.svg')
    expect(normalizeServerUrl(' https://host/ ')).toBe('https://host')
  })

  it('recognizes a native app with no configured computer as offline mode', () => {
    const platformSpy = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true)
    expect(isNativeOfflineMode()).toBe(true)
    setApiBaseUrl('https://cark.example.ts.net')
    expect(isNativeOfflineMode()).toBe(false)
    platformSpy.mockRestore()
  })
})
