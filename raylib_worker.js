import { SharedQueue } from './shared_queue.js'
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
    UPDATE_WINDOW: 2,
    TRACE_LOG: 3,
    RENDER: 4,
    LOAD_FONT: 5,
    LOAD_IMAGE: 6,
}

function makePlatform({
    self,
    rendering,
    renderer,
    rendererPort,
    syncLoader,
}) {
    const renderHandler = {
        [RENDERER.MAIN_THREAD]: self,
        [RENDERER.WORKER_THREAD]: rendererPort,
    }[renderer]
    const render = {
        [RENDERING_CTX.DD]: (ctx) => {
            const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data,
            }, [data.data.buffer])
        },
        [RENDERING_CTX.BITMAP]: (ctx) => {
            const data = ctx.canvas.transferToImageBitmap()
            renderHandler.postMessage({
                type: RESPONSE_MESSAGE_TYPE.RENDER,
                data,
            // TODO: Find out why transferring a ImageBitmap leads to memory leaks 
            }) //, [data])
            data.close()
        },
    }[rendering]
    return {
        updateWindow(title, width, height) {
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.UPDATE_WINDOW,
                title,
                width,
                height,
            })
            rendererPort.postMessage({
                type: RESPONSE_MESSAGE_TYPE.UPDATE_WINDOW,
                title,
                width,
                height,
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
        loadFont(family, fileName) {
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.LOAD_FONT,
                family,
                fileName,
            })
            self.fonts.add(new FontFace(family, syncLoader.readFontBuffer()))
        },
        loadImage(fileName) {
            self.postMessage({
                type: RESPONSE_MESSAGE_TYPE.LOAD_IMAGE,
                fileName,
            })
            const imgData = syncLoader.readImageData()
            const canvas = new OffscreenCanvas(
                imgData.width,
                imgData.height
            )
            const ctx = canvas.getContext('2d')
            ctx.putImageData(imgData, 0, 0)
            return canvas
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
        eventsBuffer,
        statusBuffer,
        syncLoaderBuffer
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
                syncLoader: new SyncLoader(syncLoaderBuffer),
            }),
            rendering,
            eventsQueue: new EventsQueue(eventsBuffer),
            statusBuffer,
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
    [RENDERING_CTX.BITMAP]: "bitmaprenderer",
}

function makeRenderHandlerFactories(canvas, rendering) {
    const ctx = canvas.getContext(RENDERING_TO_CONTEXT[rendering])
    return {
        [RENDERING_CTX.DD]: ({ data }) => {
            ctx.putImageData(data, 0, 0)
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
                case RESPONSE_MESSAGE_TYPE.UPDATE_WINDOW:
                    canvas.width = event.data.width
                    canvas.height = event.data.height
                    break
                default:
                    console.error("Unhandled message", event)
                }
            }
            return
        }
        case REQUEST_MESSAGE_TYPE.STOP:
            if (port) {
                port.onmessage = null
                port = undefined
            }
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
        this.animationFrameId = undefined
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
        this.handlers[RESPONSE_MESSAGE_TYPE.UPDATE_WINDOW] = ({ title, width, height }) => {
            platform.updateWindow(title, width, height)
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.TRACE_LOG] = ({ logLevel, message, args }) => {
            platform.traceLog(logLevel, message, args)
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.RENDER] = () => {}
        this.handlers[RESPONSE_MESSAGE_TYPE.LOAD_FONT] = ({ fileName }) => {
            fetch(fileName).then(r => r.arrayBuffer()).then(
                (buffer) => this.syncLoader.pushFontBuffer(buffer),
                console.error,
            )
        }
        this.handlers[RESPONSE_MESSAGE_TYPE.LOAD_IMAGE] = ({ fileName }) => {
            const img = new Image()
            img.onload = () => {
                const canvas = document.createElement('canvas')
                const ctx = canvas.getContext('2d')
                canvas.width = img.width
                canvas.height = img.height
                ctx.drawImage(img, 0, 0)
                const imgData = ctx.getImageData(0, 0, img.width, img.height)
                this.syncLoader.pushImageData(imgData)
            }
            // TODO: img.onerror
            img.src = fileName
        }

        const eventsBuffer = window.SharedArrayBuffer
            ? new SharedArrayBuffer(10 * 1024)
            : new ArrayBuffer(10 * 1024)
        this.eventsQueue = new EventsQueue(eventsBuffer)
        this.eventsSender = {
            [IMPL.GAME_FRAME]: (event) => this.worker.postMessage(event),
            [IMPL.BLOCKING]: (event) => this.eventsQueue.push(event),
            [IMPL.LOCKING]: (event) => this.eventsQueue.push(event),
        }[impl]

        const statusBuffer = window.SharedArrayBuffer
            ? new SharedArrayBuffer(4)
            : new ArrayBuffer(4)
        this.status = new Int32Array(statusBuffer)

        const syncLoaderBuffer = window.SharedArrayBuffer
            ? new SharedArrayBuffer(640 * 1024)
            : new ArrayBuffer(640 * 1024)
        this.syncLoader = new SyncLoader(syncLoaderBuffer)

        const channel = new MessageChannel()
        // https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas
        let offscreen = undefined
        switch (impl) {
        case IMPL.GAME_FRAME: {
            offscreen = canvas.transferControlToOffscreen()
            break
        }
        case IMPL.LOCKING:
        case IMPL.BLOCKING: {
            switch (renderer) {
                case RENDERER.MAIN_THREAD: {
                    this.handlers[RESPONSE_MESSAGE_TYPE.UPDATE_WINDOW] = ({ title, width, height }) => {
                        platform.updateWindow(title, width, height)
                        canvas.width = width
                        canvas.height = height
                    }
                    this.handlers[RESPONSE_MESSAGE_TYPE.RENDER] =
                        makeRenderHandlerFactories(canvas, rendering)
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
                offscreen = new OffscreenCanvas(800, 600)
                break
        }
        default:
            throw new Error(`Unknown impl: ${impl}`)
        }
        this.worker.addEventListener("message", this.handleMessage)
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.INIT,
            canvas: offscreen,
            eventsBuffer,
            statusBuffer,
            syncLoaderBuffer,
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
        })
        this.worker.postMessage({
            type: REQUEST_MESSAGE_TYPE.START,
            params
        })
        switch (this.impl) {
        case IMPL.BLOCKING: {
            const commitEvents = () => {
                this.eventsQueue.commit()
                this.animationFrameId = requestAnimationFrame(commitEvents)
            }
            this.animationFrameId = requestAnimationFrame(commitEvents)
            break
        }
        case IMPL.LOCKING: {
            const commitEvents = () => {
                this.eventsQueue.commit()
                Atomics.notify(this.status, 0)
                this.animationFrameId = requestAnimationFrame(commitEvents)
            }
            this.animationFrameId = requestAnimationFrame(commitEvents)
            break
        }
        }
        return this.startPromise
    }

    stop() {
        switch (this.impl) {
        case IMPL.BLOCKING:
        case IMPL.LOCKING: {
            cancelAnimationFrame(this.animationFrameId)
            break
        }
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

class EventsQueue {
  constructor(sharedMemoryBuffer) {
    this.queue = new SharedQueue(sharedMemoryBuffer)
  }

  push({ type, data }) {
    this.queue.pushUint(MESSAGE_TYPE_TO_EVENT_TYPE[type])
    switch (type) {
    case REQUEST_MESSAGE_TYPE.MOUSE_MOVE: {
        this.queue.pushFloat(data.x)
        this.queue.pushFloat(data.y)
        return
    }
    default:
        this.queue.pushInt(data)
        return
    }
  }

  commit() {
    this.queue.commit()
  }

  pop(handler) {
      const gen = this.queue.read()
      for (const item of gen) {
        const type = item.uint
        switch(type) {
        case EVENT_TYPE.MOUSE_MOVE:
            handler({
                type,
                data: {
                    x: gen.next().value.float,
                    y: gen.next().value.float,
                }
            })
            break
        default:
            handler({ type, data: gen.next().value.int })
        }
    }
  }
}

class SyncLoader {
    constructor(sharedMemoryBuffer) {
        this.queue = new SharedQueue(sharedMemoryBuffer)
    }

    pushFontBuffer(fontBuffer) {
        this.queue.pushBytes(new Uint8Array(fontBuffer))
        this.queue.commit()
    }

    readFontBuffer() {
        const g = this.queue.waitAndRead()
        return g.next().value.bytes.buffer
    }

    pushImageData(imgData) {
        this.queue.pushUint(imgData.width)
        this.queue.pushUint(imgData.height)
        this.queue.pushBytes(imgData.data)
        this.queue.commit()
    }

    readImageData() {
        const g = this.queue.waitAndRead()
        const w = g.next().value.uint
        const h = g.next().value.uint
        const imgData = new ImageData(w, h)
        imgData.data.set(g.next().value.bytes)
        return imgData
    }

}
