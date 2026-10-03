// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { readBytes, sha256Hex } from '../src/browser/hash.js'

// FIPS 180-2 test vector for "abc".
const ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('sha256Hex', () => {
  it('hashes bytes and Blobs to the same lower-case hex', async () => {
    expect(await sha256Hex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(ABC)
    expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(ABC)
    expect(await sha256Hex(new Blob(['abc']))).toBe(ABC)
  })

  it('hashes a view onto part of a buffer by its own bytes only', async () => {
    const buf = new Uint8Array([0, 0x61, 0x62, 0x63, 0])
    expect(await sha256Hex(buf.subarray(1, 4))).toBe(ABC)
  })
})

describe('readBytes', () => {
  it('reads a Blob, with or without Blob.arrayBuffer', async () => {
    expect([...(await readBytes(new Blob([new Uint8Array([1, 2, 3])])))]).toEqual([1, 2, 3])
  })
})
