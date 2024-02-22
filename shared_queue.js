export class SharedQueue {
  
  constructor(buffer) {
    this.byteArr = new Uint8Array(buffer)
    this.uintArr = new Uint32Array(buffer)
    this.intArr = new Int32Array(buffer)
    this.floatArr = new Float32Array(buffer)
    this.encoder = new TextEncoder()
    this.decoder = new TextDecoder()

    this.len = this.uintArr.length
    this.index = 0
    this.lastIndex = 0
  }

  nextIndex() {
    return this.index = (this.index + 1) % this.len
  }

  nextLastIndex() {
    return this.lastIndex = (this.lastIndex + 1) % this.len
  }

  pushUint(element) {
    this.uintArr[this.nextIndex()] = element
  }

  pushInt(element) {
    this.intArr[this.nextIndex()] = element
  }

  pushFloat(element) {
    this.floatArr[this.nextIndex()] = element
  }

  pushBytes(bytes) {
    if (this.byteArr.length < bytes.length + 12) { // commit + len + padding
      throw new Error(`Too large`)
    }
    this.pushUint(bytes.length)
    const offset = (this.index + 1) * 4
    const diff = this.byteArr.length - offset
    if (bytes.length <= diff) {
      this.byteArr.set(bytes, offset);
      this.index += Math.ceil(bytes.length / 4)
    } else {
      this.byteArr.set(bytes.subarray(0, diff), offset)
      this.byteArr.set(bytes.subarray(diff), 0)
      this.index = Math.ceil((bytes.length - diff) / 4) - 1
    }
  }

  pushString(str) {
    const encoded = this.encoder.encode(str)
    this.pushBytes(encoded)
  }

  commit() {
    if (this.lastIndex === this.index) {
      return
    }
    this.nextIndex()
    this.uintArr[this.index] = this.index
    Atomics.store(this.uintArr, this.lastIndex, this.index)
    this.lastIndex = this.index
  }

  get float() {
    return this.floatArr[this.lastIndex]
  }

  get int() {
    return this.intArr[this.lastIndex]
  }

  get uint() {
    return this.uintArr[this.lastIndex]
  }

  get bytes() {
    const len = this.uintArr[this.lastIndex]
    const bytes = new Uint8Array(len)
    const offset = (this.lastIndex + 1) * 4
    const diff = this.byteArr.length - offset
    if (len <= diff) {
      bytes.set(this.byteArr.subarray(offset, offset + len), 0)
      this.lastIndex += Math.ceil(len / 4)
    } else {
      bytes.set(this.byteArr.subarray(offset, offset + diff), 0)
      bytes.set(this.byteArr.subarray(0, len - diff), diff)
      this.lastIndex = Math.ceil((len - diff) / 4) - 1
    }
    return bytes
  }

  get string() {
    return this.decoder.decode(this.bytes)
  }

  pop(handle) {
    this.index = Atomics.load(this.uintArr, this.lastIndex)
    if (this.index === this.lastIndex) {
      return
    }
    while (this.index !== this.nextLastIndex()) {
      handle(this)
    }
  }

  *read() {
    this.index = Atomics.load(this.uintArr, this.lastIndex)
    if (this.index === this.lastIndex) {
      return
    }
    while (this.index !== this.nextLastIndex()) {
      yield this
    }
  }

}
