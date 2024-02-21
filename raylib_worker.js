import { SharedQueue } from './shared_queue.js'
import { applyCtxAction } from './remote_context.js'
import { EVENT_TYPE } from './raylib.js'
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
        },
        [RENDERING_CTX.BITMAP]: (data) => {
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data,
            })
            data.close()
        },
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
        rendererPort,
        eventsBuffer
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
            eventsQueue: new EventsQueue(eventsBuffer),
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
    handlers[REQUEST_MESSAGE_TYPE.KEY_DOWN] = ({ data }) => {
        raylibJs.handleKeyDown(data)
    }
    handlers[REQUEST_MESSAGE_TYPE.KEY_UP] = ({ data }) => {
        raylibJs.handleKeyUp(data)
    }
    handlers[REQUEST_MESSAGE_TYPE.WHEEL_MOVE] = ({ data }) => {
        raylibJs.handleWheelMove(data)
    }
    handlers[REQUEST_MESSAGE_TYPE.MOUSE_MOVE] = ({ data }) => {
        raylibJs.handleMouseMove(data)
    }
    return (event) => {
        if (handlers[event.data.type]) {
            handlers[event.data.type](event.data)
        } else {
            console.error("Unhandled message", event)
        }
    }
}

const RENDERING_TO_CONTEXT = {
    [RENDERING_CTX.DD]: "2d",
    [RENDERING_CTX.REMOTE_2D]: "2d",
    [RENDERING_CTX.BATCHED_REMOTE_2D]: "2d",
    [RENDERING_CTX.BITMAP]: "bitmaprenderer",
}

function makeRenderHandlerFactories(canvas, rendering) {
    const ctx = canvas.getContext(RENDERING_TO_CONTEXT[rendering])
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
        [RENDERING_CTX.BITMAP]: ({ data }) => {
            ctx.transferFromImageBitmap(data)
        },
    }[rendering]
}

export function makeRendererMessagesHandler(self) {
    let port = undefined
    return (event) => {
        switch (event.data.type) {
        case REQUEST_MESSAGE_TYPE.INIT: {
            const { canvas, rendering, sourcePort } = event.data
            const render = makeRenderHandlerFactories(canvas, rendering)
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
        rendererWorker,
    }) {
        this.worker = worker
        this.rendererWorker = rendererWorker
        // For manage event commits
        this.impl = impl
        this.nextCommitId = undefined
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

        const eventsBuffer = window.SharedArrayBuffer
            ? new SharedArrayBuffer(1024)
            : new ArrayBuffer(1024)
        this.eventsQueue = new EventsQueue(eventsBuffer)
        this.eventsSender = {
            [IMPL.GAME_FRAME]: (event) => this.worker.postMessage(event),
            [IMPL.BLOCKING]: (event) => this.eventsQueue.push(event),
        }[impl]

        const channel = new MessageChannel()
        // https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
        const offscreen = {
            [IMPL.GAME_FRAME]: () => canvas.transferControlToOffscreen(),
            [IMPL.BLOCKING]: () => {
                switch (renderer) {
                case RENDERER.MAIN_THREAD: {
                    this.handlers[RESPONSE_MESSAGE_TYPE.RENDER] =
                        makeRenderHandlerFactories(canvas, rendering)
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
        }[impl]()
        this.worker.addEventListener("message", this.handleMessage)
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.INIT,
            canvas: offscreen,
            eventsBuffer,
            rendering,
            impl,
            renderer,
            rendererPort: channel.port2,
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
            setTimeout(() => {
                this.stop()
            }, 1000)
        })
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.START,
            params
        })
        if (this.impl === IMPL.BLOCKING) {
            const commitEvents = () => {
                this.eventsQueue.commit()
                this.nextCommitId = requestAnimationFrame(commitEvents)
            }
            this.nextCommitId = requestAnimationFrame(commitEvents)
        }
        return this.startPromise
    }

    stop() {
        if (this.impl === IMPL.BLOCKING) {
            cancelAnimationFrame(this.nextCommitId)
        }
        this.eventsSender({
            type: REQUEST_MESSAGE_TYPE.STOP,
            data: 0,
        })
        this.worker.removeEventListener("message", this.handleMessage)
        if (this.rendererWorker) {
            this.rendererWorker.postMessage({
                type: REQUEST_MESSAGE_TYPE.STOP
            })
        }
    }

    handleKeyDown(data) {
        this.eventsSender({
            type: REQUEST_MESSAGE_TYPE.KEY_DOWN,
            data
        })
    }

    handleKeyUp(data) {
        this.eventsSender({
            type: REQUEST_MESSAGE_TYPE.KEY_UP,
            data
        })
    }

    handleWheelMove(data) {
        this.eventsSender({
            type: REQUEST_MESSAGE_TYPE.WHEEL_MOVE,
            data
        })
    }

    handleMouseMove(data) {
        this.eventsSender({
            type: REQUEST_MESSAGE_TYPE.MOUSE_MOVE,
            data
        })
    }

}

const MESSAGE_TYPE_TO_EVENT_TYPE = {
    [REQUEST_MESSAGE_TYPE.KEY_DOWN]: EVENT_TYPE.KEY_DOWN,
    [REQUEST_MESSAGE_TYPE.KEY_UP]: EVENT_TYPE.KEY_UP,
    [REQUEST_MESSAGE_TYPE.WHEEL_MOVE]: EVENT_TYPE.WHEEL_MOVE,
    [REQUEST_MESSAGE_TYPE.MOUSE_MOVE]: EVENT_TYPE.MOUSE_MOVE,
    [REQUEST_MESSAGE_TYPE.STOP]: EVENT_TYPE.STOP,
}

class EventsQueue extends SharedQueue {
  constructor(sharedMemoryBuffer) {
    super(new Int32Array(sharedMemoryBuffer));
  }

  push({ type, data }) {
    const t = MESSAGE_TYPE_TO_EVENT_TYPE[type]
    super.push(t)
    switch (type) {
    case REQUEST_MESSAGE_TYPE.MOUSE_MOVE: {
        super.push(data.x)
        super.push(data.y)
        return
    }
    default:
        super.push(data)
    }
  }

  pop(handler) {
    const gen = super.read()
    for (const type of gen) {
        switch(type) {
        case EVENT_TYPE.MOUSE_MOVE:
            const x = gen.next().value
            const y = gen.next().value
            handler({ type, data: { x, y } })
            break
        default:
            handler({ type, data: gen.next().value })
        }
    }
  }
}
