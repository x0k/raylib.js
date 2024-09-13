import { SharedQueue } from './shared_queue.js';
import { Service } from './service.js';
import {
    STATE,
    EVENT_TYPE,
    IMPL,
    RENDERING_METHOD,
    CTX_FACTORIES,
    RAYLIB_FACTORIES,
} from './raylib_factory.js';

export const RENDERER = {
    MAIN_THREAD: 'main',
    WORKER_THREAD: 'worker',
};

class SyncLoader {
    constructor(sharedMemoryBuffer, loader) {
        this.queue = new SharedQueue(sharedMemoryBuffer);
        this.loader = loader;
    }

    pushFontBuffer(fontBuffer) {
        this.queue.pushBytes(new Uint8Array(fontBuffer));
        this.queue.commit();
    }

    loadFontBuffer(fileName) {
        this.loader.loadFontBuffer(fileName);
        const g = this.queue.waitAndRead();
        return g.next().value.bytes.buffer;
    }

    pushImageData(imgData) {
        this.queue.pushUint(imgData.width);
        this.queue.pushUint(imgData.height);
        this.queue.pushBytes(imgData.data);
        this.queue.commit();
    }

    loadImageData(fileName) {
        this.loader.loadImageData(fileName);
        const g = this.queue.waitAndRead();
        const w = g.next().value.uint;
        const h = g.next().value.uint;
        const imgData = new ImageData(w, h);
        imgData.data.set(g.next().value.bytes);
        return imgData;
    }
}

class EventsQueue {
    constructor(sharedMemoryBuffer) {
        this.queue = new SharedQueue(sharedMemoryBuffer);
    }

    push(event) {
        this.queue.pushUint(event.type);
        switch (event.type) {
            case EVENT_TYPE.WHEEL_MOVE: {
                this.queue.pushInt(event.direction);
                return;
            }
            case EVENT_TYPE.KEY_DOWN:
            case EVENT_TYPE.KEY_UP: {
                this.queue.pushUint(event.keyCode);
                return;
            }
            case EVENT_TYPE.MOUSE_MOVE: {
                this.queue.pushFloat(event.x);
                this.queue.pushFloat(event.y);
                return;
            }
            case EVENT_TYPE.START: {
                this.queue.pushString(event.wasmPath);
                return;
            }
            case EVENT_TYPE.STOP:
                return;
            default:
                throw new Error(`Unknown event type ${event.type}`);
        }
    }

    commit() {
        this.queue.commit();
    }

    unwindGen(gen, handler) {
        for (const item of gen) {
            const type = item.uint;
            switch (type) {
                case EVENT_TYPE.WHEEL_MOVE: {
                    handler({
                        type,
                        direction: gen.next().value.int,
                    });
                    break;
                }
                case EVENT_TYPE.KEY_DOWN:
                case EVENT_TYPE.KEY_UP: {
                    handler({
                        type,
                        keyCode: gen.next().value.uint,
                    });
                    break;
                }
                case EVENT_TYPE.MOUSE_MOVE: {
                    handler({
                        type,
                        x: gen.next().value.float,
                        y: gen.next().value.float,
                    });
                    break;
                }
                case EVENT_TYPE.START: {
                    handler({
                        type,
                        wasmPath: gen.next().value.string,
                    });
                    break;
                }
                case EVENT_TYPE.STOP:
                    handler({ type });
                    break;
                default:
                    throw new Error(`Unknown event type ${event.type}`);
            }
        }
    }

    pop(handler) {
        const g = this.queue.read();
        this.unwindGen(g, handler);
    }

    waitAndPop(handler) {
        const g = this.queue.waitAndRead();
        this.unwindGen(g, handler);
    }
}

let iota = 0;
const REQ_MESSAGE_TYPE = {
    INIT: iota++,
    SEND: iota++,
    DESTROY: iota++,
};

const RES_MESSAGE_TYPE = {
    TRANSITION: iota++,
    UPDATE_WINDOW: iota++,
    TRACE_LOG: iota++,
    LOAD_FONT: iota++,
    LOAD_IMAGE: iota++,
    RENDER: iota++,
};

function makeWorkerPlatform({ self, syncLoader, render, updateWindow }) {
    return {
        updateWindow,
        traceLog(logLevel, text, args) {
            self.postMessage({
                type: RES_MESSAGE_TYPE.TRACE_LOG,
                logLevel,
                text,
                args,
            });
        },
        loadFont(family, fileName) {
            const data = syncLoader.loadFontBuffer(fileName);
            self.fonts.add(new FontFace(family, data));
        },
        loadImage(fileName) {
            const imgData = syncLoader.loadImageData(fileName);
            const canvas = new OffscreenCanvas(imgData.width, imgData.height);
            const ctx = canvas.getContext('2d');
            ctx.putImageData(imgData, 0, 0);
            return canvas;
        },
        render,
    };
}

const REMOTE_RENDERER_FACTORIES = {
    [RENDERING_METHOD.DD]:
        ({ handlerPort }) =>
        (ctx) => {
            const data = ctx.getImageData(
                0,
                0,
                ctx.canvas.width,
                ctx.canvas.height
            );
            handlerPort.postMessage(
                {
                    type: RES_MESSAGE_TYPE.RENDER,
                    data,
                },
                [data.data.buffer]
            );
        },
    [RENDERING_METHOD.BITMAP]:
        ({ handlerPort }) =>
        (ctx) => {
            const data = ctx.canvas.transferToImageBitmap();
            handlerPort.postMessage({
                type: RES_MESSAGE_TYPE.RENDER,
                data,
                // TODO: Find out why transferring a ImageBitmap leads to memory leaks
            }); //, [data])
            data.close();
        },
};

const REMOTE_UPDATE_WINDOW_FACTORIES = {
    [RENDERER.MAIN_THREAD]:
        ({ self }) =>
        (title, width, height) =>
            self.postMessage({
                type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
                title,
                width,
                height,
            }),
    [RENDERER.WORKER_THREAD]:
        ({ self, rendererPort }) =>
        (title, width, height) => {
            // Should update title only
            self.postMessage({
                type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
                title,
                width,
                height,
            });
            // Should update canvas size
            rendererPort.postMessage({
                type: RES_MESSAGE_TYPE.UPDATE_WINDOW,
                title,
                width,
                height,
            });
        },
};

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
    }
) {
    return RAYLIB_FACTORIES[impl]({
        ctx: CTX_FACTORIES[impl]({ canvas, rendering }),
        platform: makeWorkerPlatform({
            self,
            updateWindow: REMOTE_UPDATE_WINDOW_FACTORIES[renderer]({
                self,
                rendererPort,
            }),
            render: REMOTE_RENDERER_FACTORIES[rendering]({
                rendering,
                handlerPort: {
                    [RENDERER.MAIN_THREAD]: self,
                    [RENDERER.WORKER_THREAD]: rendererPort,
                }[renderer],
            }),
            syncLoader: new SyncLoader(syncLoaderBuffer, {
                loadFontBuffer: (fileName) =>
                    self.postMessage({
                        type: RES_MESSAGE_TYPE.LOAD_FONT,
                        fileName,
                    }),
                loadImageData: (fileName) =>
                    self.postMessage({
                        type: RES_MESSAGE_TYPE.LOAD_IMAGE,
                        fileName,
                    }),
            }),
        }),
        eventsQueue: new EventsQueue(eventsBuffer),
        statusBuffer,
    });
}

export function makeWorkerMessagesHandler(self) {
    let raylib = undefined;
    let unsub = undefined;
    const h = new Array(Object.keys(REQ_MESSAGE_TYPE).length);
    h[REQ_MESSAGE_TYPE.INIT] = (params) => {
        if (raylib !== undefined) {
            if (raylib.state !== STATE.STOPPED) {
                throw new Error(
                    'The game is already running. Please stop() it first.'
                );
            }
            unsub();
        }
        raylib = makeRaylib(self, params);
        unsub = raylib.subscribe((state) =>
            self.postMessage({
                type: RES_MESSAGE_TYPE.TRANSITION,
                state,
            })
        );
    };
    h[REQ_MESSAGE_TYPE.SEND] = ({ event }) => {
        raylib.send(event);
    };
    h[REQ_MESSAGE_TYPE.DESTROY] = () => {
        if (raylib === undefined) {
            return;
        }
        unsub();
        unsub = undefined;
        raylib.destroy();
        raylib = undefined;
    };
    return (msg) => {
        if (h[msg.data.type]) {
            h[msg.data.type](msg.data);
        } else {
            console.error('Unhandled message', msg);
        }
    };
}

const RENDERING_TO_CONTEXT = {
    [RENDERING_METHOD.DD]: '2d',
    [RENDERING_METHOD.BITMAP]: 'bitmaprenderer',
};

const REMOTE_RENDER_FACTORIES = {
    [RENDERING_METHOD.DD]:
        (ctx) =>
        ({ data }) => {
            ctx.putImageData(data, 0, 0);
        },
    [RENDERING_METHOD.BITMAP]:
        (ctx) =>
        ({ data }) => {
            ctx.transferFromImageBitmap(data);
        },
};

const blockingFactory = ({ canvas, isRenderer, rendering }) => {
    return isRenderer
        ? REMOTE_RENDER_FACTORIES[rendering](
              canvas.getContext(RENDERING_TO_CONTEXT[rendering])
          )
        : () => {};
};

const RENDER_FACTORIES = {
    [IMPL.GAME_FRAME]: () => () => {},
    [IMPL.BLOCKING]: blockingFactory,
    [IMPL.LOCKING]: blockingFactory,
};

export function makeRendererMessagesHandler() {
    let port = undefined;
    return (msg) => {
        switch (msg.data.type) {
            case REQ_MESSAGE_TYPE.INIT: {
                const render = RENDER_FACTORIES[msg.data.impl](msg.data);
                const { sourcePort, canvas } = msg.data;
                sourcePort.onmessage = (msg) => {
                    switch (msg.data.type) {
                        case RES_MESSAGE_TYPE.RENDER:
                            render(msg.data);
                            break;
                        case RES_MESSAGE_TYPE.UPDATE_WINDOW:
                            canvas.width = msg.data.width;
                            canvas.height = msg.data.height;
                            break;
                        default:
                            console.error(msg);
                            throw new Error(`Unhandled message ${msg}`);
                    }
                };
                port = sourcePort;
                return;
            }
            case REQ_MESSAGE_TYPE.DESTROY:
                if (port === undefined) {
                    return;
                }
                port.onmessage = null;
                port = undefined;
                return;
        }
    };
}

const blockingOffscreenCanvasFactory = () => new OffscreenCanvas(0, 0);

const OFFSCREEN_CANVAS_FACTORIES = {
    [IMPL.GAME_FRAME]: (canvas) => canvas.transferControlToOffscreen(),
    [IMPL.BLOCKING]: blockingOffscreenCanvasFactory,
    [IMPL.LOCKING]: blockingOffscreenCanvasFactory,
};

const blockingEventSenderFactory =
    ({ eventsQueue }) =>
    (event) => {
        eventsQueue.push(event);
    };

const EVENT_SENDER_FACTORIES = {
    [IMPL.GAME_FRAME]:
        ({ worker }) =>
        (event) =>
            worker.postMessage({
                type: REQ_MESSAGE_TYPE.SEND,
                event,
            }),
    [IMPL.BLOCKING]: blockingEventSenderFactory,
    [IMPL.LOCKING]: blockingEventSenderFactory,
};

function startEventsCommitter({ impl, eventsQueue, statusBuffer }) {
    const status = new Int32Array(statusBuffer);
    let frameId = undefined;
    let commitEvents = undefined;
    switch (impl) {
        case IMPL.GAME_FRAME:
            return () => {};
        case IMPL.BLOCKING:
            commitEvents = () => {
                eventsQueue.commit();
                frameId = requestAnimationFrame(commitEvents);
            };
            break;
        case IMPL.LOCKING:
            commitEvents = () => {
                eventsQueue.commit();
                Atomics.store(status, 0, 1);
                Atomics.notify(status, 0);
                frameId = requestAnimationFrame(commitEvents);
            };
            break;
        default:
            throw new Error(`Unknown implementation ${impl}`);
    }
    requestAnimationFrame(commitEvents);
    return () => cancelAnimationFrame(frameId);
}

const BLOCKING_UPDATE_WINDOW_FACTORIES = {
    [RENDERER.MAIN_THREAD]:
        ({ platform }) =>
        ({ title, width, height }) => {
            platform.updateWindow(title, width, height);
        },
    [RENDERER.WORKER_THREAD]:
        () =>
        ({ title }) => {
            document.title = title;
        },
};

const blockingUpdateWindowFactory = ({ renderer, ...rest }) =>
    BLOCKING_UPDATE_WINDOW_FACTORIES[renderer](rest);

const UPDATE_WINDOW_FACTORIES = {
    [IMPL.GAME_FRAME]:
        () =>
        ({ title }) => {
            document.title = title;
        },
    [IMPL.BLOCKING]: blockingUpdateWindowFactory,
    [IMPL.LOCKING]: blockingUpdateWindowFactory,
};

const BLOCKING_RENDERER_FACTORIES = {
    [RENDERER.MAIN_THREAD]: () => {},
    [RENDERER.WORKER_THREAD]: ({
        canvas,
        rendererWorker,
        impl,
        rendering,
        sourcePort,
    }) => {
        const offscreen = canvas.transferControlToOffscreen();
        rendererWorker.postMessage(
            {
                type: REQ_MESSAGE_TYPE.INIT,
                impl,
                rendering,
                canvas: offscreen,
                isRenderer: true,
                sourcePort,
            },
            [offscreen, sourcePort]
        );
    },
};

const blockingRendererFactory = ({ renderer, ...rest }) =>
    BLOCKING_RENDERER_FACTORIES[renderer](rest);

const RENDERER_FACTORIES = {
    [IMPL.GAME_FRAME]: () => () => {},
    [IMPL.BLOCKING]: blockingRendererFactory,
    [IMPL.LOCKING]: blockingRendererFactory,
};

export class RaylibJsWorker extends Service {
    handleMessage = (event) => {
        if (this.h[event.data.type]) {
            this.h[event.data.type](event.data);
        } else {
            throw new Error(`Unhandled message ${event}`);
        }
    };

    constructor({
        impl,
        canvas,
        platform,
        rendering,
        renderer,
        worker,
        rendererWorker,
    }) {
        super(STATE.STOPPED);
        this.worker = worker;
        this.worker.addEventListener('message', this.handleMessage);
        this.rendererWorker = rendererWorker;

        this.impl = impl;

        const Buffer = window.SharedArrayBuffer
            ? SharedArrayBuffer
            : ArrayBuffer;
        const eventsBuffer = new Buffer(10 * 1024);
        const eventsQueue = new EventsQueue(eventsBuffer);
        this.send = EVENT_SENDER_FACTORIES[impl]({ worker, eventsQueue });

        const statusBuffer = new Buffer(4);

        this.stopEventsCommitter = startEventsCommitter({
            impl,
            eventsQueue,
            statusBuffer,
        });

        const syncLoaderBuffer = new Buffer(640 * 1024);
        const syncLoader = new SyncLoader(syncLoaderBuffer);

        this.h = new Array(Object.keys(RES_MESSAGE_TYPE).length);
        this.h[RES_MESSAGE_TYPE.TRANSITION] = ({ state }) => {
            this.state = state;
            for (const handler of this.subscribers) {
                handler(state);
            }
        };
        this.h[RES_MESSAGE_TYPE.UPDATE_WINDOW] = UPDATE_WINDOW_FACTORIES[impl]({
            renderer,
            platform,
        });
        this.h[RES_MESSAGE_TYPE.TRACE_LOG] = ({ logLevel, text, args }) => {
            platform.traceLog(logLevel, text, args);
        };
        this.h[RES_MESSAGE_TYPE.LOAD_FONT] = ({ fileName }) => {
            fetch(fileName)
                .then((r) => r.arrayBuffer())
                .then(
                    (buffer) => syncLoader.pushFontBuffer(buffer),
                    console.error
                );
        };
        const tmpCanvas = document.createElement('canvas');
        const tmpCtx = tmpCanvas.getContext('2d');
        this.h[RES_MESSAGE_TYPE.LOAD_IMAGE] = ({ fileName }) => {
            const img = new Image();
            img.onload = () => {
                tmpCanvas.width = img.width;
                tmpCanvas.height = img.height;
                tmpCtx.drawImage(img, 0, 0);
                const imgData = tmpCtx.getImageData(
                    0,
                    0,
                    img.width,
                    img.height
                );
                syncLoader.pushImageData(imgData);
            };
            // TODO: img.onerror
            img.src = fileName;
        };
        this.h[RES_MESSAGE_TYPE.RENDER] = RENDER_FACTORIES[impl]({
            canvas,
            rendering,
            isRenderer: renderer === RENDERER.MAIN_THREAD,
        });

        const channel = new MessageChannel();
        RENDERER_FACTORIES[impl]({
            canvas,
            renderer,
            rendererWorker: this.rendererWorker,
            impl,
            rendering,
            sourcePort: channel.port1,
        });
        const offscreen = OFFSCREEN_CANVAS_FACTORIES[impl](canvas);
        this.worker.postMessage(
            {
                type: REQ_MESSAGE_TYPE.INIT,
                impl,
                canvas: offscreen,
                rendering,
                renderer,
                rendererPort: channel.port2,
                eventsBuffer,
                statusBuffer,
                syncLoaderBuffer,
            },
            [offscreen, channel.port2]
        );
    }

    destroy() {
        super.destroy();
        this.stopEventsCommitter();
        if (this.rendererWorker) {
            this.rendererWorker.postMessage({
                type: REQ_MESSAGE_TYPE.DESTROY,
            });
        }
        this.worker.postMessage({
            type: REQ_MESSAGE_TYPE.DESTROY,
        });
        this.worker.removeEventListener('message', this.handleMessage);
    }
}
