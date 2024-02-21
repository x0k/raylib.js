import { makeRemoteContext, makeBatchedRemoteContext } from './remote_context.js'
import { BlockingRaylibJs, RaylibJs } from './raylib.js'

export const IMPL = {
    GAME_FRAME: "gameFrame",
    BLOCKING: "blocking",
}

export const RENDERING_CTX = {
    DD: "2d",
    REMOTE_2D: "remote2d",
    BATCHED_REMOTE_2D: "batchedRemote2d",
}

const remoteContextFactories = {
    [RENDERING_CTX.DD]: ({ canvas, platform }) => {
        let canvasProxy
        return new Proxy(canvas.getContext('2d', {
            willReadFrequently: true
        }), {
            get(target, prop) {
                if (prop === "canvas") {
                    return canvasProxy ??= new Proxy(target.canvas, {
                        get(target, prop) {
                            return target[prop]
                        },
                        set(target, prop, value) {
                            if (prop === "width" || prop === "height") {
                                platform.updateCanvas(prop, value)
                            }
                            target[prop] = value
                            return true
                        }
                    })
                }
                return target[prop].bind(target)
            },
            set(target, prop, value) {
                target[prop] = value
                return true
            }
        })
    },
    [RENDERING_CTX.REMOTE_2D]: ({ canvas, platform }) => makeRemoteContext(
        platform.render.bind(platform),
        canvas.getContext("2d"),
        {
            width: canvas.width,
            height: canvas.height,
        }
    ),
    [RENDERING_CTX.BATCHED_REMOTE_2D]: ({ canvas }) => makeBatchedRemoteContext(
        canvas.getContext("2d"),
        {
            width: canvas.width,
            height: canvas.height,
        }
    ),
}

export function createRaylib({
    impl,
    canvas,
    platform,
    rendering,
    eventsQueue,
}) {
    switch (impl) {
    case IMPL.GAME_FRAME: {
        const ctx = canvas.getContext("2d")
        return new RaylibJs(ctx, platform)
    }
    case IMPL.BLOCKING: {
        const ctx = remoteContextFactories[rendering]({ canvas, platform })
        return new BlockingRaylibJs(ctx, platform, eventsQueue)
    }
    default:
        throw new Error(`Unknown impl: ${impl}`)
    }
}