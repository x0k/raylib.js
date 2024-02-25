import { SharedQueue } from './shared_queue.js'
import {
    STATE,
    EVENT_TYPE,
    IMPL,
    RENDERING_METHOD,
    createRaylib
} from './raylib_factory.js'

export const RENDERER = {
    MAIN_THREAD: "main",
    WORKER_THREAD: "worker",
}

class SyncLoader {
    constructor(sharedMemoryBuffer, loader) {
        this.queue = new SharedQueue(sharedMemoryBuffer)
        this.loader = loader
    }

    pushFontBuffer(fontBuffer) {
        this.queue.pushBytes(new Uint8Array(fontBuffer))
        this.queue.commit()
    }

    loadFontBuffer(fileName) {
        this.loader.loadFontBuffer(fileName)
        const g = this.queue.waitAndRead()
        return g.next().value.bytes.buffer
    }

    pushImageData(imgData) {
        this.queue.pushUint(imgData.width)
        this.queue.pushUint(imgData.height)
        this.queue.pushBytes(imgData.data)
        this.queue.commit()
    }

    loadImageData(fileName) {
        this.loader.loadImageData(fileName)
        const g = this.queue.waitAndRead()
        const w = g.next().value.uint
        const h = g.next().value.uint
        const imgData = new ImageData(w, h)
        imgData.data.set(g.next().value.bytes)
        return imgData
    }
}

class EventsQueue {
  constructor(sharedMemoryBuffer) {
    this.queue = new SharedQueue(sharedMemoryBuffer)
  }

  push(event) {
    this.queue.pushUint(event.type)
    switch (event.type) {
    case EVENT_TYPE.WHEEL_MOVE: {
        this.queue.pushInt(event.direction)
        return
    }
    case EVENT_TYPE.KEY_DOWN:
    case EVENT_TYPE.KEY_UP: {
        this.queue.pushUint(event.keyCode)
        return
    }
    case EVENT_TYPE.MOUSE_MOVE: {
        this.queue.pushFloat(event.x)
        this.queue.pushFloat(event.y)
        return
    }
    case EVENT_TYPE.START: {
        this.queue.pushString(event.wasmPath)
        return
    }
    case EVENT_TYPE.STOP:
        return
    default:
        throw new Error(`Unknown event type ${event.type}`)
    }
  }

  commit() {
    this.queue.commit()
  }

  unwindGen(gen, handler) {
      for (const item of gen) {
        const type = item.uint
        switch (type) {
        case EVENT_TYPE.WHEEL_MOVE: {
            handler({
              type,
              direction: gen.next().value.int,
            })
            break
        }
        case EVENT_TYPE.KEY_DOWN:
        case EVENT_TYPE.KEY_UP: {
            handler({
              type,
              keyCode: gen.next().value.uint,
            })
            break
        }
        case EVENT_TYPE.MOUSE_MOVE: {
            handler({
              type,
              x: gen.next().value.float,
              y: gen.next().value.float,
            })
            break
        }
        case EVENT_TYPE.START: {
            handler({
              type,
              wasmPath: gen.next().value.string,
            })
            break
        }
        case EVENT_TYPE.STOP:
            handler({ type })
            break
        default:
            throw new Error(`Unknown event type ${event.type}`)
        }
    }
  }

  pop(handler) {
    const g = this.queue.read()
    this.unwindGen(g, handler)
  }

  waitAndPop(handler) {
    const g = this.queue.waitAndRead()
    this.unwindGen(g, handler)
  }

}

let iota = 0
const REQ_MESSAGE_TYPE = {
    INIT: iota++,
    SEND: iota++,
    DESTROY: iota++,
}

const RES_MESSAGE_TYPE = {
    TRANSITION: iota++,
    UPDATE_WINDOW: iota++,
    TRACE_LOG: iota++,
    LOAD_FONT: iota++,
    LOAD_IMAGE: iota++,
    RENDER: iota++,
}

function makeWorkerPlatform({
    self,
    syncLoader,
    render,
    updateWindow,
}) {
    return {
        updateWindow,
        traceLog(logLevel, text, args) {
            self.postMessage({
                type: RES_MESSAGE_TYPE.TRANSITION,
                logLevel,
                text,
                args,
            })
        },
        loadFont(family, fileName) {
            const data = syncLoader.loadFontBuffer(fileName)
            self.fonts.add(new FontFace(family, data))
        },
        loadImage(fileName) {
            const imgData = syncLoader.loadImageData(fileName)
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

function makeRemoteRender({ rendering, handlerPort }) {
    switch (rendering) {
    case RENDERING_METHOD.DD:
        return (ctx) => {
            const data = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height)
            handlerPort.postMessage({
                type: RES_MESSAGE_TYPE.RENDER,
                data,
            }, [data.data.buffer])
        }
    case RENDERING_METHOD.BITMAP:
        return (ctx) => {
            const data = ctx.canvas.transferToImageBitmap()
            handlerPort.postMessage({
                type: RES_MESSAGE_TYPE.RENDER,
                data,
            // TODO: Find out why transferring a ImageBitmap leads to memory leaks
            }) //, [data])
            data.close()
        }
    default:
        throw new Error(`Unknown rendering context ${rendering}`)
    }
}

function makeRemoteUpdateWindow({ renderer, self, rendererPort }) {
    switch (renderer) {
    case RENDERER.MAIN_THREAD:
        return (title, width, height) => self.postMessage({
            type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
            title,
            width,
            height,
        })
    case RENDERER.WORKER_THREAD:
    return (title, width, height) => {
        // Should update title only
        self.postMessage({
            type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
            title,
            width,
            height,
        })
        // Should update canvas size
        rendererPort.postMessage({
            type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
            title,
            width,
            height,
        })
    }
    default:
        throw new Error(`Unknown renderer ${renderer}`)
    }
}

function makeRaylib(
    self,
    {
        impl,
        canvas,
        rendering,
        renderer,
        rendererPort,
        eventsBuffer,
        statusBuffer,
        syncLoaderBuffer,
    },
) {
    const handlerPort = {
        [RENDERER.MAIN_THREAD]: self,
        [RENDERER.WORKER_THREAD]: rendererPort,
    }[renderer]
    return createRaylib({
        impl,
        canvas,
        rendering,
        platform: makeWorkerPlatform({
            self,
            updateWindow: makeRemoteUpdateWindow({
                renderer,
                self,
                rendererPort,
            }),
            render: makeRemoteRender({
                rendering,
                handlerPort,
            }),
            syncLoader: new SyncLoader(syncLoaderBuffer, {
                loadFontBuffer: (fileName) => self.postMessage({
                    type: RES_MESSAGE_TYPE.LOAD_FONT,
                    fileName,
                }),
                loadImageData: (fileName) => self.postMessage({
                    type: RES_MESSAGE_TYPE.LOAD_IMAGE,
                    fileName,
                }),
            }),
        }),
        eventsQueue: new EventsQueue(eventsBuffer),
        statusBuffer,
    })
}

export function makeWorkerMessagesHandler(self) {
    let raylib = undefined
    let unsub = undefined
    const h = new Array(Object.keys(REQ_MESSAGE_TYPE).length)
    h[REQ_MESSAGE_TYPE.INIT] = (params) => {
        if (raylib !== undefined) {
            if (raylib.state !== STATE.STOPPED) {
                throw new Error("The game is already running. Please stop() it first.")
            }
            unsub()
        }
        raylib = makeRaylib(self, params)
        unsub = raylib.subscribe((state) => self.postMessage({
            type: RES_MESSAGE_TYPE.TRANSITION,
            state
        }))
    }
    h[REQ_MESSAGE_TYPE.SEND] = ({ event }) => {
        raylib.send(event)
    }
    h[REQ_MESSAGE_TYPE.DESTROY] = () => {
        unsub?.()
        unsub = undefined
        raylib = undefined
    }
    return (msg) => {
        if (h[msg.data.type]) {
            h[msg.data.type](msg.data)
        } else {
            console.error("Unhandled message", msg)
        }
    }
}

const RENDERING_TO_CONTEXT = {
    [RENDERING_METHOD.DD]: "2d",
    [RENDERING_METHOD.BITMAP]: "bitmaprenderer",
}

function makeRender({ impl, canvas, rendering, isRenderer }) {
    switch (impl) {
    case IMPL.GAME_FRAME:
        return () => {}
    case IMPL.BLOCKING:
    case IMPL.LOCKING: {
        if (!isRenderer) {
            return () => {}
        }
        const ctx = canvas.getContext(RENDERING_TO_CONTEXT[rendering])
        switch (rendering) {
        case RENDERING_METHOD.DD:
            return ({ data }) => {
                ctx.putImageData(data, 0, 0)
            }
        case RENDERING_METHOD.BITMAP:
            return ({ data }) => {
                ctx.transferFromImageBitmap(data)
            }
        default:
            throw new Error(`Unknown rendering method ${rendering}`)
        }
    }
    default:
        throw new Error(`Unknown implementation ${impl}`)
    }
}

export function makeRendererMessagesHandler() {
    let port = undefined
    return (msg) => {
        switch (msg.data.type) {
        case REQ_MESSAGE_TYPE.INIT: {
            const render = makeRender(msg.data)
            const { sourcePort, canvas } = msg.data
            sourcePort.onmessage = (msg) => {
                switch (msg.data.type) {
                case RES_MESSAGE_TYPE.RENDER:
                    render(msg.data)
                    break
                case RES_MESSAGE_TYPE.UPDATE_WINDOW:
                    canvas.width = msg.data.width
                    canvas.height = msg.data.height
                    break
                default:
                    console.error(msg)
                    throw new Error(`Unhandled message ${msg}`)
                }
            }
            port = sourcePort
            return
        }
        case REQ_MESSAGE_TYPE.DESTROY:
            if (!port) {
                return
            }
            port.onmessage = null
            port = undefined
            return
        }
    }
}

function makeOffscreenCanvas({ impl, canvas }) {
    switch (impl) {
    case IMPL.GAME_FRAME:
        return canvas.transferControlToOffscreen()
    case IMPL.BLOCKING:
    case IMPL.LOCKING:
        return new OffscreenCanvas(0, 0)
    default:
        throw new Error(`Unknown implementation ${impl}`)
    }
}

function makeEventsSender({ impl, worker, eventsQueue }) {
    switch (impl) {
    case IMPL.GAME_FRAME:
        return (event) => worker.postMessage({
            type: REQ_MESSAGE_TYPE.SEND,
            event,
        })
    case IMPL.BLOCKING:
    case IMPL.LOCKING:
        return (event) => eventsQueue.push(event)
    default:
        throw new Error(`Unknown implementation ${impl}`)
    }
}

function startEventsCommiter({ impl, eventsQueue, statusBuffer }) {
    const status = new Int32Array(statusBuffer)
    let frameId = undefined
    let commitEvents = undefined
    switch (impl) {
    case IMPL.GAME_FRAME:
        return () => {}
    case IMPL.BLOCKING:
        commitEvents = () => {
            eventsQueue.commit()
            frameId = requestAnimationFrame(commitEvents)
        }
        break
    case IMPL.LOCKING:
        commitEvents = () => {
            eventsQueue.commit()
            Atomics.notify(status, 0)
            frameId = requestAnimationFrame(commitEvents)
        }
        break
    default:
        throw new Error(`Unknown implementation ${impl}`)
    }
    requestAnimationFrame(commitEvents)
    return () => cancelAnimationFrame(frameId)
}

function makeUpdateWindow({ impl, renderer, platform }) {
    const updateDocTitle = ({ title }) => {
        document.title = title
    }
    switch (impl) {
    case IMPL.GAME_FRAME:
        return updateDocTitle
    case IMPL.BLOCKING:
    case IMPL.LOCKING:
        switch (renderer) {
        case RENDERER.MAIN_THREAD:
            return ({ title, width, height }) => {
                platform.updateWindow(title, width, height)
            }
        case RENDERER.WORKER_THREAD:
            return updateDocTitle
        default:
            throw new Error(`Unknown renderer ${renderer}`)
        }
    default:
        throw new Error(`Unknown implementation ${impl}`)
    }
}

export class RaylibJsWorker {

    handleMessage = (event) => {
        if (this.h[event.data.type]) {
            this.h[event.data.type](event.data)
        } else {
            throw new Error(`Unhandled message ${event}`)
        }
    }

    constructor({
        impl,
        canvas,
        platform,
        rendering,
        renderer,
        worker,
        rendererWorker
    }) {
        this.worker = worker
        this.worker.addEventListener("message", this.handleMessage)
        this.rendererWorker = rendererWorker

        this.impl = impl
        this.subscribers = new Set()
        
        const Buffer = window.SharedArrayBuffer ? SharedArrayBuffer : ArrayBuffer
        const eventsBuffer = new Buffer(10 * 1024)
        const eventsQueue = new EventsQueue(eventsBuffer)
        this.send = makeEventsSender({
            impl,
            worker,
            eventsQueue,
        })

        const statusBuffer = new Buffer(4)
        this.status = new Int32Array(statusBuffer)

        this.stopEventsCommiter = startEventsCommiter({
            impl,
            eventsQueue,
            statusBuffer,
        })

        const syncLoaderBuffer = new Buffer(640 * 1024)
        const syncLoader = new SyncLoader(syncLoaderBuffer)

        this.h = new Array(Object.keys(RES_MESSAGE_TYPE).length)
        this.h[RES_MESSAGE_TYPE.TRANSITION] = ({ state }) => {
            for (const handler of this.subscribers) {
                handler(state)
            }
        }
        this.h[RES_MESSAGE_TYPE.UPDATE_WINDOW] = makeUpdateWindow({
            impl, renderer, platform
        })
        this.h[RES_MESSAGE_TYPE.TRACE_LOG] = ({ logLevel, text, args }) => {
            platform.traceLog(logLevel, text, args)
        }
        this.h[RES_MESSAGE_TYPE.LOAD_FONT] = ({ fileName }) => {
            fetch(fileName).then(r => r.arrayBuffer()).then(
                (buffer) => syncLoader.pushFontBuffer(buffer),
                console.error,
            )
        }
        const tmpCanvas = document.createElement('canvas')
        const tmpCtx = tmpCanvas.getContext('2d')
        this.h[RES_MESSAGE_TYPE.LOAD_IMAGE] = ({ fileName }) => {
            const img = new Image()
            img.onload = () => {
                tmpCanvas.width = img.width
                tmpCanvas.height = img.height
                tmpCtx.drawImage(img, 0, 0)
                const imgData = tmpCtx.getImageData(0, 0, img.width, img.height)
                syncLoader.pushImageData(imgData)
            }
            // TODO: img.onerror
            img.src = fileName
        }
        this.h[RES_MESSAGE_TYPE.RENDER] = makeRender({
            impl,
            canvas,
            rendering,
            isRenderer: renderer === RENDERER.MAIN_THREAD,
        })

        const channel = new MessageChannel()
        if (impl !== IMPL.GAME_FRAME && renderer === RENDERER.WORKER_THREAD) {
            const offscreen = canvas.transferControlToOffscreen()
            this.rendererWorker.postMessage({
                type: REQ_MESSAGE_TYPE.INIT,
                impl,
                rendering,
                canvas: offscreen,
                isRenderer: true,
                sourcePort: channel.port1
            }, [offscreen, channel.port1])
        }
        const offscreen = makeOffscreenCanvas({ impl, canvas })
        this.worker.postMessage({
            type: REQ_MESSAGE_TYPE.INIT,
            impl,
            canvas: offscreen,
            rendering,
            renderer,
            rendererPort: channel.port2,
            eventsBuffer,
            statusBuffer,
            syncLoaderBuffer,
        }, [offscreen, channel.port2])
    }

    subscribe(onTransition) {
        this.subscribers.add(onTransition)
        return () => {
            this.subscribers.delete(onTransition)
        }
    }

    destroy() {
        this.subscribers.clear()
        this.stopEventsCommiter()
        if (this.rendererWorker) {
            this.rendererWorker.postMessage({
                type: REQ_MESSAGE_TYPE.DESTROY
            })
        }
        this.worker.postMessage({
            type: REQ_MESSAGE_TYPE.DESTROY
        })
        this.worker.removeEventListener("message", this.handleMessage)
    }
}
