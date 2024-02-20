import { RaylibJsBase } from './raylib_base.js'

let iota = 0;
const LOG_ALL     = iota++; // Display all logs
const LOG_TRACE   = iota++; // Trace logging, intended for internal use only
const LOG_DEBUG   = iota++; // Debug logging, used for internal debugging, it should be disabled on release builds
const LOG_INFO    = iota++; // Info logging, used for program execution info
const LOG_WARNING = iota++; // Warning logging, used on recoverable failures
const LOG_ERROR   = iota++; // Error logging, used on unrecoverable failures
const LOG_FATAL   = iota++; // Fatal logging, used to abort program: exit(EXIT_FAILURE)
const LOG_NONE    = iota++; // Disable logging

export function makePlatform({ canvas }) {
    return {
        updateTitle(title) {
            document.title = title
        },
        traceLog(logLevel, text, args) {
            switch(logLevel) {
            case LOG_ALL:     console.log(`ALL: ${text} ${args}`);     break;
            case LOG_TRACE:   console.log(`TRACE: ${text} ${args}`);   break;
            case LOG_DEBUG:   console.log(`DEBUG: ${text} ${args}`);   break;
            case LOG_INFO:    console.log(`INFO: ${text} ${args}`);    break;
            case LOG_WARNING: console.log(`WARNING: ${text} ${args}`); break;
            case LOG_ERROR:   console.log(`ERROR: ${text} ${args}`);   break;
            case LOG_FATAL:   throw new Error(`FATAL: ${text}`);
            case LOG_NONE:    console.log(`NONE: ${text} ${args}`);    break;
            }
        },
        addFont(font) {
            document.fonts.add(font)
        },
        loadImage(filename) {
            var img = new Image();
            img.src = filename;
            return { status: "loaded", data: img }
        },
        /** Blocking platform API */
        render() {
            // TODO: This is not working solution to force repaint the canvas
            // in the blocked thread.
            // This will allow to use the blocking implementation with a main thread
            canvas.style.cssText += ';-webkit-transform:rotateZ(0deg)'
            canvas.offsetHeight
            canvas.style.cssText += ';-webkit-transform:none'
        },
        updateCanvas() {},
    }
}

export class RaylibJs extends RaylibJsBase {
    constructor(ctx, platform) {
        super(ctx, platform);
        this.frameId = undefined
    }

    next = (timestamp) => {
        this.dt = (timestamp - this.previous)/1000.0;
        this.previous = timestamp;
        this.entryFunction();
        this.frameId = requestAnimationFrame(this.next);
    }

    async start(params) {
        await super.start(params);
        this.frameId = requestAnimationFrame((timestamp) => {
            this.previous = timestamp
            this.frameId= requestAnimationFrame(this.next)
        });
    }

    stop() {
        cancelAnimationFrame(this.frameId);
        super.stop();
    }

    SetTargetFPS(fps) {
        super.SetTargetFPS(fps)
        this.platform.traceLog(LOG_INFO, `The game wants to run at ${fps} FPS.`);
    }
}

export class BlockingRaylibJs extends RaylibJsBase {

    constructor(canvas, platform) {
        super(canvas, platform);
        this.windowShouldClose = false
        this.frameTime = undefined
    }

    start(params) {
        this.previous = performance.now()
        return super.start(params)
    } 

    stop() {
        this.windowShouldClose = true
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

    // TODO: Pull events from the queue
    BeginDrawing() {
        let now
        do {
            now = performance.now()
            this.dt = (now - this.previous)/1000.0
        } while (this.dt < this.frameTime)
        this.previous = now
    }

    EndDrawing() {
        super.EndDrawing()
        const imgData = this.ctx.getImageData(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.platform.render(imgData);
    }

}

export const glfwKeyMapping = {
    "Space":          32,
    "Quote":          39,
    "Comma":          44,
    "Minus":          45,
    "Period":         46,
    "Slash":          47,
    "Digit0":         48,
    "Digit1":         49,
    "Digit2":         50,
    "Digit3":         51,
    "Digit4":         52,
    "Digit5":         53,
    "Digit6":         54,
    "Digit7":         55,
    "Digit8":         56,
    "Digit9":         57,
    "Semicolon":      59,
    "Equal":          61,
    "KeyA":           65,
    "KeyB":           66,
    "KeyC":           67,
    "KeyD":           68,
    "KeyE":           69,
    "KeyF":           70,
    "KeyG":           71,
    "KeyH":           72,
    "KeyI":           73,
    "KeyJ":           74,
    "KeyK":           75,
    "KeyL":           76,
    "KeyM":           77,
    "KeyN":           78,
    "KeyO":           79,
    "KeyP":           80,
    "KeyQ":           81,
    "KeyR":           82,
    "KeyS":           83,
    "KeyT":           84,
    "KeyU":           85,
    "KeyV":           86,
    "KeyW":           87,
    "KeyX":           88,
    "KeyY":           89,
    "KeyZ":           90,
    "BracketLeft":    91,
    "Backslash":      92,
    "BracketRight":   93,
    "Backquote":      96,
    //  GLFW_KEY_WORLD_1   161 /* non-US #1 */
    //  GLFW_KEY_WORLD_2   162 /* non-US #2 */
    "Escape":         256,
    "Enter":          257,
    "Tab":            258,
    "Backspace":      259,
    "Insert":         260,
    "Delete":         261,
    "ArrowRight":     262,
    "ArrowLeft":      263,
    "ArrowDown":      264,
    "ArrowUp":        265,
    "PageUp":         266,
    "PageDown":       267,
    "Home":           268,
    "End":            269,
    "CapsLock":       280,
    "ScrollLock":     281,
    "NumLock":        282,
    "PrintScreen":    283,
    "Pause":          284,
    "F1":             290,
    "F2":             291,
    "F3":             292,
    "F4":             293,
    "F5":             294,
    "F6":             295,
    "F7":             296,
    "F8":             297,
    "F9":             298,
    "F10":            299,
    "F11":            300,
    "F12":            301,
    "F13":            302,
    "F14":            303,
    "F15":            304,
    "F16":            305,
    "F17":            306,
    "F18":            307,
    "F19":            308,
    "F20":            309,
    "F21":            310,
    "F22":            311,
    "F23":            312,
    "F24":            313,
    "F25":            314,
    "NumPad0":        320,
    "NumPad1":        321,
    "NumPad2":        322,
    "NumPad3":        323,
    "NumPad4":        324,
    "NumPad5":        325,
    "NumPad6":        326,
    "NumPad7":        327,
    "NumPad8":        328,
    "NumPad9":        329,
    "NumpadDecimal":  330,
    "NumpadDivide":   331,
    "NumpadMultiply": 332,
    "NumpadSubtract": 333,
    "NumpadAdd":      334,
    "NumpadEnter":    335,
    "NumpadEqual":    336,
    "ShiftLeft":      340,
    "ControlLeft" :   341,
    "AltLeft":        342,
    "MetaLeft":       343,
    "ShiftRight":     344,
    "ControlRight":   345,
    "AltRight":       346,
    "MetaRight":      347,
    "ContextMenu":    348,
    //  GLFW_KEY_LAST   GLFW_KEY_MENU
}
