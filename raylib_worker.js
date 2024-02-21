import { applyCtxAction } from './remote_context.js'
import { createRaylib, IMPL, RENDERING_CTX } from './raylib_factory.js'

const REQUEST_MESSAGE_TYPE = {
    INIT: 0,
    START: 1,
    STOP: 2,
    KEY_DOWN: 3,
    KEY_UP: 4,
    WHEEL_MOVE: 5,
    MOUSE_MOVE: 6,
}

const RESPONSE_MESSAGE_TYPE = {
    START_SUCCESS: 0,
    START_FAIL: 1,
    UPDATE_TITLE: 2,
    TRACE_LOG: 3,
    RENDER: 4,
    UPDATE_CANVAS: 5,
    LOAD_FONT: 6,
}

function makePlatform({ self, rendering, renderer, rendererPort }) {
    const renderHandler = {
        [RENDERER.MAIN_THREAD]: self,
        [RENDERER.WORKER_THREAD]: rendererPort,
    }[renderer]
    const render = {
        [RENDERING_CTX.DD]: (data) => {
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data,
            }, [data.data.buffer])
        },
        [RENDERING_CTX.REMOTE_2D]: (data) => {
            data && renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data
            })
        },
        [RENDERING_CTX.BATCHED_REMOTE_2D]: (data) => {
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data
            })
        }
    }[rendering]
    return {
        updateTitle(title) {
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.UPDATE_TITLE,
                title
            })
        },
        traceLog(logLevel, message, args) {
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.TRACE_LOG,
                logLevel,
                message,
                args,
            })
        },
        addFont(font, source) {
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.LOAD_FONT,
                family: font.family,
                source
            })
            self.fonts.add(font)
            // TODO: this is not working in blocking mode
            font.load()
        },
        loadImage(filename) {
            const img = {
                status: "loading",
                data: undefined,
                error: undefined
            }
            fetch(filename)
                .then(res => res.blob())
                .then(blob => createImageBitmap(blob))
                .then(data => {
                    img.status = "loaded"
                    img.data = data
                }, (error) => {
                    img.status = "error"
                    img.error = error
                })
            return img
        },
        updateCanvas(property, value) {
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.UPDATE_CANVAS,
                property,
                value
            })
        },
        render,
    }
}

export function makeWorkerMessagesHandler(self) {
    let raylibJs = undefined
    const handlers = new Array(Object.keys(REQUEST_MESSAGE_TYPE).length)
    handlers[REQUEST_MESSAGE_TYPE.INIT] = ({
        canvas,
        impl,
        rendering,
        renderer,
        rendererPort
    }) => {
        if (raylibJs) {
            raylibJs.stop()
        }
        raylibJs = createRaylib({
            impl,
            canvas,
            platform: makePlatform({
                self,
                rendering,
                renderer,
                rendererPort,
            }),
            rendering,
        })
    }
    handlers[REQUEST_MESSAGE_TYPE.START] = async ({ params }) => {
        try {
            await self.fonts.ready
            await raylibJs.start(params)
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.START_SUCCESS
            })
        } catch (error) {
            console.log(error)
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.START_FAIL,
                reason: String(error)
            })
        }
    }
    handlers[REQUEST_MESSAGE_TYPE.STOP] = () => {
        raylibJs.stop()
    }
    handlers[REQUEST_MESSAGE_TYPE.KEY_DOWN] = ({ keyCode }) => {
        raylibJs.handleKeyDown(keyCode)
    }
    handlers[REQUEST_MESSAGE_TYPE.KEY_UP] = ({ keyCode }) => {
        raylibJs.handleKeyUp(keyCode)
    }
    handlers[REQUEST_MESSAGE_TYPE.WHEEL_MOVE] = ({ direction }) => {
        raylibJs.handleWheelMove(direction)
    }
    handlers[REQUEST_MESSAGE_TYPE.MOUSE_MOVE] = ({ position }) => {
        raylibJs.handleMouseMove(position)
    }
    return (event) => {
        if (handlers[event.data.type]) {
            handlers[event.data.type](event.data)
        } else {
            console.error("Unhandled message", event)
        }
    }
}

function makeRenderHandlerFactories(ctx) {
    return {
        [RENDERING_CTX.DD]: ({ data }) => {
            ctx.putImageData(data, 0, 0)
        },
        [RENDERING_CTX.REMOTE_2D]: ({ data }) => {
            applyCtxAction(ctx, data)
        },
        [RENDERING_CTX.BATCHED_REMOTE_2D]: ({ data }) => {
            for (let i = 0; i < data.length; i++) {
                applyCtxAction(ctx, data[i])
            }
        },
    }
}

export function makeRendererMessagesHandler(self) {
    let port = undefined
    return (event) => {
        switch (event.data.type) {
        case REQUEST_MESSAGE_TYPE.INIT: {
            const { canvas, rendering, sourcePort } = event.data
            const render = makeRenderHandlerFactories(
                canvas.getContext("2d")
            )[rendering]
            port = sourcePort
            port.onmessage = (event) => {
                switch (event.data.type) {
                case RESPONSE_MESSAGE_TYPE.RENDER:
                    render(event.data)
                    break
                case RESPONSE_MESSAGE_TYPE.UPDATE_CANVAS:
                    canvas[event.data.property] = event.data.value
                    break
                case RESPONSE_MESSAGE_TYPE.LOAD_FONT: {
                    new FontFace(
                        event.data.family,
                        event.data.source,
                    ).load(
                        (f) => self.fonts.add(f),
                        console.error,
                    )
                    break
                }
                default:
                    console.error("Unhandled message", event)
                }
            }
            return
        }
        case REQUEST_MESSAGE_TYPE.STOP:
            port.onmessage = null
            port = undefined
            return
        }
    }
}

export const RENDERER = {
    MAIN_THREAD: "main",
    WORKER_THREAD: "worker",
}

export class RaylibJsWorker {

    handleMessage = (event) => {
        if (this.handlers[event.data.type]) {
            this.handlers[event.data.type](event.data)
        } else {
            console.error("Unhandled message", event)
        }
    }

    constructor({
        worker,
        canvas,
        platform,
        impl,
        rendering,
        renderer,
        rendererWorker
    }) {
        this.worker = worker
        this.rendererWorker = rendererWorker
        this.startPromise = undefined
        this.onStartSuccess = undefined
        this.onStartFail = undefined

        this.handlers = new Array(Object.keys(RESPONSE_MESSAGE_TYPE).length)
        this.handlers[RESPONSE_MESSAGE_TYPE.START_SUCCESS] = () => {
            if (this.onStartSuccess) {
                this.onStartSuccess()
            }
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.START_FAIL] = ({ reason }) => {
            if (this.onStartFail) {
                this.onStartFail(new Error(reason))
            }
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.UPDATE_TITLE] = ({ title }) => {
            platform.updateTitle(title)
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.TRACE_LOG] = ({ logLevel, message, args }) => {
            platform.traceLog(logLevel, message, args)
        }
        /** Blocking platform API */
        this.handlers[RESPONSE_MESSAGE_TYPE.RENDER] = () => {}
        this.handlers[RESPONSE_MESSAGE_TYPE.UPDATE_CANVAS] = () => {}
        this.handlers[RESPONSE_MESSAGE_TYPE.LOAD_FONT] = ({ family, source }) => {
            platform.addFont(new FontFace(family, source), source)
        }

        const channel = new MessageChannel()
        // https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
        const canvasFactories = {
            [IMPL.GAME_FRAME]: () => canvas.transferControlToOffscreen(),
            [IMPL.BLOCKING]: () => {
                switch (renderer) {
                case RENDERER.MAIN_THREAD: {
                    this.handlers[RESPONSE_MESSAGE_TYPE.RENDER] =
                    makeRenderHandlerFactories(canvas.getContext("2d"))[rendering]
                    this.handlers[RESPONSE_MESSAGE_TYPE.UPDATE_CANVAS] = ({ property, value }) => {
                        canvas[property] = value
                    }
                    break
                }
                case RENDERER.WORKER_THREAD: {
                    const offscreen = canvas.transferControlToOffscreen()
                    this.rendererWorker.postMessage({
                        type: REQUEST_MESSAGE_TYPE.INIT,
                        canvas: offscreen,
                        rendering,
                        sourcePort: channel.port1
                    }, [offscreen, channel.port1])
                    break
                }
                default:
                    throw new Error(`Unknown renderer: ${renderer}`)
                }
                // Fake canvas to measure the text in worker thread
                return new OffscreenCanvas(800, 600)
            }
        }
        const offscreen = canvasFactories[impl]()
        this.worker.addEventListener("message", this.handleMessage)
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.INIT,
            canvas: offscreen,
            rendering,
            impl,
            renderer,
            rendererPort: channel.port2
        }, [offscreen, channel.port2])
    }

    async start(params) {
        if (this.startPromise) {
            return this.startPromise
        }
        this.startPromise = new Promise((resolve, reject) => {
            this.onStartSuccess = resolve
            this.onStartFail = reject
        }).then(() => {
            this.startPromise = undefined
            this.onStartSuccess = undefined
            this.onStartFail = undefined
        })
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.START,
            params
        })
        return this.startPromise
    }

    stop() {
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.STOP
        })
        this.worker.removeEventListener("message", this.handleMessage)
        if (this.rendererWorker) {
            this.rendererWorker.postMessage({
                type: REQUEST_MESSAGE_TYPE.STOP
            })
        }
    }

    handleKeyDown(keyCode) {
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.KEY_DOWN,
            keyCode
        })
    }

    handleKeyUp(keyCode) {
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.KEY_UP,
            keyCode
        })
    }

    handleWheelMove(direction) {
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.WHEEL_MOVE,
            direction
        })
    }

    handleMouseMove(position) {
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.MOUSE_MOVE,
            position
        })
    }

}