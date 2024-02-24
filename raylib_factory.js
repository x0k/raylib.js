import { RaylibJsBase, RaylibJs, EVENT_TYPE as _EVENT_TYPE, STATE as _STATE } from './raylib.js'

let iota = Object.keys(_STATE).length
export const STATE = {
    ..._STATE,
    STOPPING: iota++
}

iota = Object.keys(_EVENT_TYPE).length
export const EVENT_TYPE = {
    ..._EVENT_TYPE,
    STOPPED: iota++
}

export class BlockingRaylibJs extends RaylibJsBase {

    onStarted(params) {
        this.previous = performance.now()
        super.onStarted(params)
        this.send({ type: EVENT_TYPE.STOPPED })
    }

    onStop() {
        this.windowShouldClose = true
    }

    onStopped() {
        super.onStop()
        this.windowShouldClose = false
    }

    constructor({ ctx, platform, eventsQueue }) {
        super(ctx, platform);
        this.eventsQueue = eventsQueue
        this.windowShouldClose = false
        this.frameTime = undefined
        this.config = {
            ...this.config,
            [STATE.STARTED]: {
                ...this.config[STATE.STARTED],
                [EVENT_TYPE.STOP]: {
                    target: STATE.STOPPING,
                    action: this.onStop.bind(this),
                },
            },
            [STATE.STOPPING]: {
                [EVENT_TYPE.STOPPED]: {
                    target: STATE.STOPPED,
                    action: this.onStopped.bind(this),
                }
            }
        }
        this.send = this.send.bind(this)
        this.eventsQueue.waitAndPop(this.send)
    }

    SetTargetFPS(fps) {
        super.SetTargetFPS(fps)
        this.frameTime = 1.0/fps
    }

    WindowShouldClose() {
        return this.windowShouldClose
    }

    CloseWindow() {
        super.stop()
        this.windowShouldClose = false
    }

    BeginDrawing() {
        this.eventsQueue.pop(this.send)
        let now
        do {
            now = performance.now()
            this.dt = (now - this.previous)/1000.0
        } while (this.dt < this.frameTime)
        this.previous = now
    }

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

    BeginDrawing() {
        Atomics.wait(this.status, 0, 0);
        this.eventsQueue.pop(this.send)
        const now = performance.now();
        this.dt = (now - this.previous)/1000.0;
        this.previous = now;
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
