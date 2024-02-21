const CTX_ACTION = {
    CLEAR_RECT: 0,
    SET_WIDTH: 1,
    SET_HEIGHT: 2,
    BEGIN_PATH: 3,
    ARC: 4,
    SET_FILL_STYLE: 5,
    FILL: 6,
    FILL_RECT: 7,
    SET_FONT: 8,
    FILL_TEXT: 9,
    SET_STROKE_STYLE: 10,
    SET_LINE_WIDTH: 11,
    STROKE_RECT: 12,
    DRAW_IMAGE: 13,
}

export function applyCtxAction(ctx, action) {
    switch(action.type) {
    case CTX_ACTION.CLEAR_RECT:
        ctx.clearRect(action.x, action.y, action.w, action.h)
        break;
    case CTX_ACTION.SET_WIDTH:
        ctx.canvas.width = action.w
        break;
    case CTX_ACTION.SET_HEIGHT:
        ctx.canvas.height = action.h
        break;
    case CTX_ACTION.BEGIN_PATH:
        ctx.beginPath()
        break;
    case CTX_ACTION.ARC:
        ctx.arc(action.x, action.y, action.radius, action.startAngle, action.endAngle, action.antiClockwise)
        break;
    case CTX_ACTION.SET_FILL_STYLE:
        ctx.fillStyle = action.color
        break;
    case CTX_ACTION.FILL:
        ctx.fill()
        break;
    case CTX_ACTION.FILL_RECT:
        ctx.fillRect(action.x, action.y, action.w, action.h)
        break;
    case CTX_ACTION.SET_FONT:
        ctx.font = action.font
        break;
    case CTX_ACTION.FILL_TEXT:
        ctx.fillText(action.text, action.x, action.y)
        break;
    case CTX_ACTION.SET_STROKE_STYLE:
        ctx.strokeStyle = action.color
        break;
    case CTX_ACTION.SET_LINE_WIDTH:
        ctx.lineWidth = action.w
        break;
    case CTX_ACTION.STROKE_RECT:
        ctx.strokeRect(action.x, action.y, action.w, action.h)
        break;
    case CTX_ACTION.DRAW_IMAGE:
        ctx.drawImage(action.img, action.x, action.y, action.w, action.h)
    }
}

export function makeRemoteContext(send, ctx, initialData) {
    const len = Object.keys(CTX_ACTION).length
    const p = Array.from(Array(len), () => [])
    const idx = Array(len).fill(0)
    const beginPath = { type: CTX_ACTION.BEGIN_PATH }
    const fill = { type: CTX_ACTION.FILL }
    return {
        canvas: {
            get width() {
                return initialData.width
            },
            set width(w) {
                initialData.width = w
                const data = p[CTX_ACTION.SET_WIDTH][idx[CTX_ACTION.SET_WIDTH]++] ??= {
                    type: CTX_ACTION.SET_WIDTH,
                    w,
                }
                data.w = w
                send(data)
            },
            get height() {
                return initialData.height
            },
            set height(h) {
                initialData.height = h
                const data = p[CTX_ACTION.SET_HEIGHT][idx[CTX_ACTION.SET_HEIGHT]++] ??= {
                    type: CTX_ACTION.SET_HEIGHT,
                    h,
                }
                data.h = h
                send(data)
            },
        },
        set fillStyle(color) {
            const data = p[CTX_ACTION.SET_FILL_STYLE][idx[CTX_ACTION.SET_FILL_STYLE]++] ??= {
                type: CTX_ACTION.SET_FILL_STYLE,
                color,
            }
            data.color = color
            send(data)
        },
        set font(font) {
            ctx.font = font
            const data = p[CTX_ACTION.SET_FONT][idx[CTX_ACTION.SET_FONT]++] ??= {
                type: CTX_ACTION.SET_FONT,
                font,
            }
            data.font = font
            send(data)
        },
        set strokeStyle(color) {
            const data = p[CTX_ACTION.SET_STROKE_STYLE][idx[CTX_ACTION.SET_STROKE_STYLE]++] ??= {
                type: CTX_ACTION.SET_STROKE_STYLE,
                color,
            }
            data.color = color
            send(data)
        },
        set lineWidth(w) {
            const data = p[CTX_ACTION.SET_LINE_WIDTH][idx[CTX_ACTION.SET_LINE_WIDTH]++] ??= {
                type: CTX_ACTION.SET_LINE_WIDTH,
                w,
            }
            data.w = w
            send(data)
        },
        clearRect(x, y, w, h) {
            const data = p[CTX_ACTION.CLEAR_RECT][idx[CTX_ACTION.CLEAR_RECT]++] ??= {
                type: CTX_ACTION.CLEAR_RECT,
                x,
                y,
                w,
                h,
            }
            data.x = x
            data.y = y
            data.w = w
            data.h = h
            send(data)
        },
        beginPath() {
            send(beginPath)
        },
        arc(x, y, radius, startAngle, endAngle, antiClockwise) {
            const data = p[CTX_ACTION.ARC][idx[CTX_ACTION.ARC]++] ??= {
                type: CTX_ACTION.ARC,
                x,
                y,
                radius,
                startAngle,
                endAngle,
                antiClockwise
            }
            data.x = x
            data.y = y
            data.radius = radius
            data.startAngle = startAngle
            data.endAngle = endAngle
            data.antiClockwise = antiClockwise
            send(data)
        },
        fill() {
            send(fill)
        },
        fillRect(x, y, w, h) {
            const data = p[CTX_ACTION.FILL_RECT][idx[CTX_ACTION.FILL_RECT]++] ??= {
                type: CTX_ACTION.FILL_RECT,
                x,
                y,
                w,
                h,
            }
            data.x = x
            data.y = y
            data.w = w
            data.h = h
            send(data)
        },
        fillText(text, x, y) {
            const data = p[CTX_ACTION.FILL_TEXT][idx[CTX_ACTION.FILL_TEXT]++] ??= {
                type: CTX_ACTION.FILL_TEXT,
                text,
                x,
                y,
            }
            data.text = text
            data.x = x
            data.y = y
            send(data)
        },
        strokeRect(x, y, w, h) {
            const data = p[CTX_ACTION.STROKE_RECT][idx[CTX_ACTION.STROKE_RECT]++] ??= {
                type: CTX_ACTION.STROKE_RECT,
                x,
                y,
                w,
                h,
            }
            data.x = x
            data.y = y
            data.w = w
            data.h = h
            send(data)
        },
        measureText(text) {
            return ctx.measureText(text)
        },
        drawImage(img, x, y) {
            const data = p[CTX_ACTION.DRAW_IMAGE][idx[CTX_ACTION.DRAW_IMAGE]++] ??= {
                type: CTX_ACTION.DRAW_IMAGE,
                img,
                x,
                y,
            }
            data.img = img
            data.x = x
            data.y = y
            send(data)
        },
        getImageData() {
            for (let i = 0; i < len; i++) {
                idx[i] = 0
            }
        }
    }
}

export function makeBatchedRemoteContext(ctx, initialData) {
    const batch = []
    const remoteCtx = makeRemoteContext(
        (action) => { batch.push(action) },
        ctx,
        initialData
    )
    const reset = remoteCtx.getImageData
    remoteCtx.getImageData = () => {
        const data = batch.slice()
        batch.length = 0
        reset()
        return data
    }
    return remoteCtx
}
