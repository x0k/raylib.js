export class SharedQueue {
  
  constructor(typedArray) {
    this.array = typedArray
    this.len = typedArray.length
    this.index = 0
    this.lastIndex = 0
  }

  nextIndex() {
    return this.index = (this.index + 1) % this.len
  }

  nextLastIndex() {
    return this.lastIndex = (this.lastIndex + 1) % this.len
  }

  push(element) {
    this.array[this.nextIndex()] = element
  }

  write(array) {
    const len = array.length
    if (len >= this.len) {
      throw new Error(`Too large`)
    }
    this.array[this.nextIndex()] = array.length
    const offset = this.index + 1
    const diff = this.len - offset
    if (array.length < diff) {
      this.array.set(array, offset)
      // will be less than this.len
      this.index += array.length
    } else {
      this.array.set(array.subarray(0, diff), offset)
      this.array.set(array.subarray(diff), 0)
      this.index = array.length - diff - 1
    }
  }

  commit() {
    if (this.lastIndex === this.index) {
      return
    }
    this.nextIndex()
    this.array[this.index] = this.index
    Atomics.store(this.array, this.lastIndex, this.index)
    this.lastIndex = this.index
  }

  pop(handle) {
    this.index = Atomics.load(this.array, this.lastIndex)
    if (this.index === this.lastIndex) {
      return
    }
    while (this.index !== this.nextLastIndex()) {
      handle(this.array[this.lastIndex])
    }
  }

  *read() {
    this.index = Atomics.load(this.array, this.lastIndex)
    if (this.index === this.lastIndex) {
      return
    }
    while (this.index !== this.nextLastIndex()) {
      yield this.array[this.lastIndex]
    }
  }

}
