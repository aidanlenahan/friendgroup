import { describe, expect, it } from 'vitest'
import {
  normalizeApiBaseUrl,
  readJsonResponse,
  resolveApiBaseUrlFromEnv,
} from './api'

describe('api helpers', () => {
  it('trims trailing slashes from configured base URLs', () => {
    expect(normalizeApiBaseUrl('https://api.friendgroup.dev/')).toBe(
      'https://api.friendgroup.dev'
    )
    expect(normalizeApiBaseUrl('/api/')).toBe('/api')
  })

  it('prefers explicit API base URL over legacy config', () => {
    expect(
      resolveApiBaseUrlFromEnv({
        explicitBase: 'https://api.friendgroup.dev/',
        legacyBase: 'http://localhost:4000',
        pageHost: 'friendgroup.ngrok-free.app',
      })
    ).toBe('https://api.friendgroup.dev')
  })

  it('defaults to proxy path when no API env vars are configured', () => {
    expect(resolveApiBaseUrlFromEnv({})).toBe('/api')
  })

  it('uses proxy path for remote clients when legacy base points at loopback', () => {
    expect(
      resolveApiBaseUrlFromEnv({
        legacyBase: 'http://127.0.0.1:4000/',
        pageHost: 'friendgroup.ngrok-free.app',
      })
    ).toBe('/api')
  })

  it('keeps loopback legacy base for local clients', () => {
    expect(
      resolveApiBaseUrlFromEnv({
        legacyBase: 'http://localhost:4000/',
        pageHost: 'localhost',
      })
    ).toBe('http://localhost:4000')
  })

  it('falls back to proxy path when legacy base is malformed', () => {
    expect(
      resolveApiBaseUrlFromEnv({
        legacyBase: 'not a url',
        pageHost: 'friendgroup.ngrok-free.app',
      })
    ).toBe('/api')
  })

  it('parses JSON responses and returns text for non-JSON responses', async () => {
    const jsonResult = await readJsonResponse(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    )

    expect(jsonResult).toEqual({ data: { ok: true }, message: null })

    const textResult = await readJsonResponse(
      new Response('Gateway unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'content-type': 'text/plain' },
      })
    )

    expect(textResult).toEqual({
      data: null,
      message: 'Gateway unavailable',
    })
  })
})