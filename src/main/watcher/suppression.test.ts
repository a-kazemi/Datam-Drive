import { describe, expect, it } from 'vitest'
import { consumeSuppressedLocalWrite, suppressLocalWrite } from './suppression'

describe('local write suppression', () => {
  it('consumes a remote write suppression once', () => {
    const localPath = 'C:\\Users\\test\\Sync\\Document.docx'

    suppressLocalWrite(localPath)

    expect(consumeSuppressedLocalWrite(localPath)).toBe(true)
    expect(consumeSuppressedLocalWrite(localPath)).toBe(false)
  })

  it('normalizes path casing', () => {
    suppressLocalWrite('C:\\Users\\test\\Sync\\Document.docx')

    expect(consumeSuppressedLocalWrite('c:\\users\\test\\sync\\document.docx')).toBe(true)
  })
})
