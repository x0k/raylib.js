import {
    RaylibJsBase,
    RaylibJs,
    EVENT_TYPE as _EVENT_TYPE,
    STATE as _STATE,
    glfwKeyMapping,
} from './raylib.js'

let iota = Object.keys(_STATE).length
export const STATE = {
    ..._STATE,
    RUNNING: iota++,
    STOPPING: iota++
}

iota = Object.keys(_EVENT_TYPE).length
export const EVENT_TYPE = {
    ..._EVENT_TYPE,
    STOPPED: iota++
}

export class BlockingRaylibJs extends RaylibJsBase {

    pullEvents = () => {
        this.eventsQueue.pop(this.send)
        requestAnimationFrame(this.pullEvents)
    }

    onRunning(event) {
        this.previous = performance.now()
        cancelAnimationFrame(this.eventsPullId)
        this.onStarted(event)
        this.send({ type: EVENT_TYPE.STOPPED })
    }

    onStopping() {
        this.eventsPullId = requestAnimationFrame(this.pullEvents)
    }

    constructor({ ctx, platform, eventsQueue }) {
        super(ctx, platform);
        this.eventsQueue = eventsQueue
        this.windowShouldClose = false
        this.frameTime = undefined
        this.unpressedKeys = new Uint16Array(Object.keys(glfwKeyMapping).length)
        this.unpressedKeyIndex = 0
        this.config = {
            ...this.config,
            // Required for successful notification of the transition
            // to the STARTED state
            [STATE.STARTED]: {
                always: {
                    target: STATE.RUNNING,
                }
            },
            [STATE.RUNNING]: {
                enter: this.onRunning.bind(this),
                on: {
                    ...this.config[STATE.STARTED].on,
                    [EVENT_TYPE.KEY_UP]: {
                        assign: ({ keyCode }) => {
                            this.unpressedKeys[this.unpressedKeyIndex++] = keyCode
                        },
                    },
                    [EVENT_TYPE.STOP]: {
                        target: STATE.STOPPING,
                        assign: () => {
                            this.windowShouldClose = true
                        },
                    },
                },
            },
            [STATE.STOPPING]: {
                enter: this.onStopping.bind(this),
                on: {
                    [EVENT_TYPE.STOPPED]: {
                        target: STATE.STOPPED,
                        assign: () => {
                            this.windowShouldClose = false
                        },
                    },
                },
            }
        }
        this.processEvent = this.processEvent.bind(this)
        this.send = this.send.bind(this)
        this.eventsPullId = requestAnimationFrame(this.pullEvents)
    }

    SetTargetFPS(fps) {
        super.SetTargetFPS(fps)
        this.frameTime = 1.0/fps
    }

    WindowShouldClose() {
        while(this.unpressedKeyIndex > 0) {
            this.currentPressedKeyState.delete(this.unpressedKeys[--this.unpressedKeyIndex])
        }
        let now
        this.eventsQueue.pop(this.processEvent)
        do {
            now = performance.now()
            this.dt = (now - this.previous)/1000.0
        } while (this.dt < this.frameTime)
        this.previous = now
        return this.windowShouldClose
    }

    CloseWindow() {}

    EndDrawing() {
        super.EndDrawing()
        this.platform.render(this.ctx);
    }
}

export class LockingRaylibJs extends BlockingRaylibJs {
    constructor({ statusBuffer, ...rest }) {
        super(rest);
        this.status = new Int32Array(statusBuffer);
    }

    WindowShouldClose() {
        while(this.unpressedKeyIndex > 0) {
            this.currentPressedKeyState.delete(this.unpressedKeys[--this.unpressedKeyIndex])
        }
        Atomics.wait(this.status, 0, 0);
        Atomics.store(this.status, 0, 0);
        this.eventsQueue.pop(this.processEvent)
        const now = performance.now();
        this.dt = (now - this.previous)/1000.0;
        this.previous = now;
        return this.windowShouldClose
    }
}

export const IMPL = {
    GAME_FRAME: "gameFrame",
    BLOCKING: "blocking",
    LOCKING: "locking",
}

export const RENDERING_METHOD = {
    DD: "2d",
    BITMAP: "bitmap",
}

const remoteContextFactory = {
    [RENDERING_METHOD.DD]: (canvas) => canvas.getContext('2d', {
        willReadFrequently: true
    }),
    [RENDERING_METHOD.BITMAP]: (canvas) => canvas.getContext('2d')
}

export function createRaylib({
    impl,
    canvas,
    platform,
    rendering,
    eventsQueue,
    statusBuffer,
}) {
    switch (impl) {
    case IMPL.GAME_FRAME: {
        const ctx = canvas.getContext("2d")
        return new RaylibJs(ctx, platform)
    }
    case IMPL.BLOCKING: {
        const ctx = remoteContextFactory[rendering](canvas)
        return new BlockingRaylibJs({
            ctx,
            platform,
            eventsQueue
        })
    }
    case IMPL.LOCKING: {
        const ctx = remoteContextFactory[rendering](canvas)
        return new LockingRaylibJs({
            ctx,
            platform,
            eventsQueue,
            statusBuffer,
        })
    }
    default:
        throw new Error(`Unknown impl: ${impl}`)
    }
}
