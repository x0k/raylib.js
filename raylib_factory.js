import { BlockingRaylibJs, RaylibJs, LockingRaylibJs } from './raylib.js'

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
        return new BlockingRaylibJs(ctx, platform, eventsQueue)
    }
    case IMPL.LOCKING: {
        const canvas = new OffscreenCanvas(0, 0)
        const ctx = remoteContextFactories[rendering](canvas)
        return new LockingRaylibJs(ctx, platform, eventsQueue, statusBuffer)
    }
    default:
        throw new Error(`Unknown impl: ${impl}`)
    }
}