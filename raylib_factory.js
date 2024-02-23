import { RaylibJsBase, RaylibJs, EVENT_TYPE, STATE } from './raylib.js'

let iota = Object.keys(STATE).length
const STATE2 = {
    ...STATE,
    STOPPING: iota++
}

iota = Object.keys(EVENT_TYPE).length
const EVENT_TYPE2 = {
    ...EVENT_TYPE,
    STOPPED: iota++
}

export class BlockingRaylibJs extends RaylibJsBase {

    onStarted(params) {
        this.previous = performance.now()
        super.onStarted(params)
        this.dispatch({ type: EVENT_TYPE2.STOPPED })
    }

    onStop() {
        switch (this.state) {
        case STATE.STARTED:
            this.state = STATE.STOPPING
            this.windowShouldClose = true
            break
        default:
            super.onStop()
        }
    }

    onStopped() {
        this.windowShouldClose = false
        super.onStop()
    }

    constructor({ ctx, platform, eventsQueue }) {
        super(ctx, platform);
        this.eventsQueue = eventsQueue
        this.windowShouldClose = false
        this.frameTime = undefined
        this.handlers = {
            ...this.handlers,
            [STATE2.STOPPING]: {
                [EVENT_TYPE2.STOPPED]: this.onStopped.bind(this),
            }
        }
        this.dispatch = this.dispatch.bind(this)
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
        this.eventsQueue.pop(this.dispatch)
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
        this.eventsQueue.pop(this.dispatch)
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

export const RENDERING_CTX = {
    DD: "2d",
    BITMAP: "bitmap",
}

const remoteContextFactories = {
    [RENDERING_CTX.DD]: (canvas) => canvas.getContext('2d', {
        willReadFrequently: true
    }),
    [RENDERING_CTX.BITMAP]: (canvas) => canvas.getContext('2d')
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
        const canvas = new OffscreenCanvas(0, 0)
        const ctx = remoteContextFactories[rendering](canvas)
        return new BlockingRaylibJs({
            ctx,
            platform,
            eventsQueue
        })
    }
    case IMPL.LOCKING: {
        const canvas = new OffscreenCanvas(0, 0)
        const ctx = remoteContextFactories[rendering](canvas)
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