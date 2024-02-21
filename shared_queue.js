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
