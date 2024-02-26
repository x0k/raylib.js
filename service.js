let iota = 0
export const STATE = {
  STOPPED: iota++,
  STARTED: iota++,
}

iota = 0
export const EVENT_TYPE = {
  START: iota++,
  STOP: iota++,
}

export class Service {
  runTransition(transition, event) {
    if (transition === undefined) {
      return
    }
    let stateConfig = this.config[this.state]
    // stateConfig.exit?.(event)
    transition.assign?.(event)
    if (transition.target === undefined) {
        return
    }
    this.state = transition.target
    stateConfig = this.config[this.state]
    stateConfig.enter?.(event)
    for (const handler of this.subscribers) {
        handler(this.state)
    }
    return this.runTransition(stateConfig.always, event)
  }

  processEvent(event) {
    this.runTransition(this.config[this.state].on[event.type], event)
  }

  constructor(initialState) {
    this.state = initialState
    this.subscribers = new Set()
    this.events = []
  }

  send(event) {
    if (this.inProcess) {
        this.events.push(event)
        return
    }
    this.inProcess = true
    do {
        this.processEvent(event)
    } while(event = this.events.shift())
    this.inProcess = false
  }

  subscribe(onTransition) {
      this.subscribers.add(onTransition)
      return () => {
          this.subscribers.delete(onTransition)
      }
  }
      
  start(params) {
    const promise = new Promise((res) => {
        const unsub = this.subscribe((state) => {
          if (state === STATE.STARTED) {
              unsub()
              res()
          }
        })
    })
    this.send({ ...params, type: EVENT_TYPE.START })
    return promise
  }

  stop(params) {
      const promise = new Promise((res) => {
          const unsub = this.subscribe((state) => {
              if (state === STATE.STOPPED) {
                  unsub()
                  res()
              }
          })
      })
      this.send({ ...params, type: EVENT_TYPE.STOP })
      return promise
  }

  destroy() {
      this.subscribers.clear()
  }
}
