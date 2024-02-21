import { BlockingRaylibJs, RaylibJs } from './raylib.js'

export const IMPL = {
    GAME_FRAME: "gameFrame",
    BLOCKING: "blocking",
}

export const RENDERING_CTX = {
    DD: "2d",
    BITMAP: "bitmap",
}

const remoteContextFactories = {
    [RENDERING_CTX.DD]: ({ canvas, platform }) => {
        let canvasProxy
        return new Proxy(canvas.getContext('2d', {
            willReadFrequently: true
        }), {
            get(target, prop) {
                switch (prop) {
                case "canvas":
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
                default:
                    return target[prop].bind(target)
                }
            },
            set(target, prop, value) {
                target[prop] = value
                return true
            }
        })
    },
    [RENDERING_CTX.BITMAP]: ({ canvas, platform }) => {
        let canvasProxy
        return new Proxy(canvas.getContext('2d'), {
            get(target, prop) {
                switch (prop) {
                case "canvas":
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
                case "getImageData":
                    return () => target.canvas.transferToImageBitmap()
                default:
                    return target[prop].bind(target)
                }
            },
            set(target, prop, value) {
                target[prop] = value
                return true
            }
        })
    },
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
        const canvas = new OffscreenCanvas(0, 0)
        const ctx = remoteContextFactories[rendering]({ canvas, platform })
        return new BlockingRaylibJs(ctx, platform, eventsQueue)
    }
    default:
        throw new Error(`Unknown impl: ${impl}`)
    }
}