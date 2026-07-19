// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import { getApiBaseUrl, normalizeServerUrl, setApiBaseUrl, withApiBaseUrl } from '@/utils/apiBase'

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
})
