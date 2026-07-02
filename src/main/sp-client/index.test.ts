import { beforeEach, describe, expect, it, vi } from 'vitest'
import fetch from 'node-fetch'
import { getAuthRequestOptions } from '../auth'
import { spFetch } from './index'

vi.mock('node-fetch', () => ({ default: vi.fn() }))
vi.mock('../auth', () => ({
  getAuthRequestOptions: vi.fn(),
  getCurrentAuth: vi.fn(),
  reauthenticate: vi.fn(),
}))
vi.mock('../logger', () => ({ log: vi.fn() }))

const fetchMock = vi.mocked(fetch)
const getAuthRequestOptionsMock = vi.mocked(getAuthRequestOptions)

describe('spFetch', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('passes the SharePoint auth agent to node-fetch', async () => {
    const agent = { keepAlive: true }
    getAuthRequestOptionsMock.mockResolvedValue({
      headers: { Authorization: 'NTLM token' },
      agent: agent as never,
    })
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: vi.fn() },
    } as never)

    await spFetch('https://sharepoint.local/_api/web/lists')

    expect(getAuthRequestOptionsMock).toHaveBeenCalledWith('https://sharepoint.local/_api/web/lists')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://sharepoint.local/_api/web/lists',
      expect.objectContaining({
        agent,
        headers: expect.objectContaining({
          Authorization: 'NTLM token',
          Accept: 'application/json;odata=nometadata',
        }),
      }),
    )
  })

  it('adds a SharePoint request digest to POST requests', async () => {
    getAuthRequestOptionsMock.mockResolvedValue({
      headers: { Authorization: 'NTLM token' },
    })
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ FormDigestValue: 'digest-value', FormDigestTimeoutSeconds: 900 }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: vi.fn() },
      } as never)

    await spFetch('https://sharepoint.local/sites/dev/_api/web/lists', { method: 'POST', body: '{}' })

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://sharepoint.local/sites/dev/_api/contextinfo',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://sharepoint.local/sites/dev/_api/web/lists',
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-RequestDigest': 'digest-value',
        }),
      }),
    )
  })
})
