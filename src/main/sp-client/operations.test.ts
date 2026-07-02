import { beforeEach, describe, expect, it, vi } from 'vitest'
import { spFetch } from './index'
import { getChanges, getListItems } from './operations'

vi.mock('./index', () => ({ spFetch: vi.fn() }))

const spFetchMock = vi.mocked(spFetch)

describe('getListItems', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('selects the REST version field exposed by SharePoint', async () => {
    spFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ value: [] }),
    } as never)

    await getListItems('https://sharepoint.local', 'list-guid')

    expect(spFetchMock).toHaveBeenCalledWith(
      expect.stringContaining('OData__UIVersionString'),
    )
    expect(spFetchMock).toHaveBeenCalledWith(
      expect.not.stringContaining('Modified,_UIVersionString'),
    )
  })
})

describe('getChanges', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('uses DeleteObject in the SharePoint change query', async () => {
    spFetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ value: [] }),
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ StringValue: 'next-token' }),
      } as never)

    await getChanges('https://sharepoint.local', 'list-guid', 'start-token')

    expect(spFetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('/GetChanges'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"DeleteObject":true'),
      }),
    )
    expect(spFetchMock).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({
        body: expect.not.stringContaining('"Delete":true'),
      }),
    )
  })
})
