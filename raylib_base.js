function make_environment(env) {
    return new Proxy(env, {
        get(target, prop, receiver) {
            if (env[prop] !== undefined) {
                return env[prop].bind(env);
            }
            return (...args) => {
                throw new Error(`NOT IMPLEMENTED: ${prop} ${args}`);
            }
        }
    });
}

function cstrlen(mem, ptr) {
    let len = 0;
    while (mem[ptr] != 0) {
        len++;
        ptr++;
    }
    return len;
}

function cstr_by_ptr(mem_buffer, ptr) {
    const mem = new Uint8Array(mem_buffer);
    const len = cstrlen(mem, ptr);
    const bytes = new Uint8Array(mem_buffer, ptr, len);
    return new TextDecoder().decode(bytes);
}

function color_hex_unpacked(r, g, b, a) {
    r = r.toString(16).padStart(2, '0');
    g = g.toString(16).padStart(2, '0');
    b = b.toString(16).padStart(2, '0');
    a = a.toString(16).padStart(2, '0');
    return "#"+r+g+b+a;
}

function color_hex(color) {
    const r = ((color>>(0*8))&0xFF).toString(16).padStart(2, '0');
    const g = ((color>>(1*8))&0xFF).toString(16).padStart(2, '0');
    const b = ((color>>(2*8))&0xFF).toString(16).padStart(2, '0');
    const a = ((color>>(3*8))&0xFF).toString(16).padStart(2, '0');
    return "#"+r+g+b+a;
}

function getColorFromMemory(buffer, color_ptr) {
    const [r, g, b, a] = new Uint8Array(buffer, color_ptr, 4);
    return color_hex_unpacked(r, g, b, a);
}

export class RaylibJsBase {
    // TODO: We stole the font from the website
    // (https://raylib.com/) and it's slightly different than
    // the one that is "baked" into Raylib library itself. To
    // account for the differences we scale the size with a
    // magical factor.
    //
    // It would be nice to have a better approach...
    #FONT_SCALE_MAGIC = 0.65;

    #reset() {
        this.previous = undefined;
        this.wasm = undefined;
        this.dt = undefined;
        this.targetFPS = 60;
        this.entryFunction = undefined;
        this.prevPressedKeyState = new Set();
        this.currentPressedKeyState = new Set();
        this.currentMouseWheelMoveState = 0;
        this.currentMousePosition = {x: 0, y: 0};
        this.images = [];
    }
    
    constructor(ctx, platform) {
        this.ctx = ctx
        this.platform = platform
        this.#reset();
    }

    handleKeyDown(keyCode) {
        this.currentPressedKeyState.add(keyCode);
    }

    handleKeyUp(keyCode) {
        this.currentPressedKeyState.delete(keyCode);
    }

    handleWheelMove(direction) {
        this.currentMouseWheelMoveState = direction
    }

    handleMouseMove(position) {
        this.currentMousePosition = position
    }

    async start({ wasmPath }) {
        if (this.wasm !== undefined) {
            throw new Error("The game is already running. Please stop() it first.");
        }
        this.wasm = await WebAssembly.instantiateStreaming(fetch(wasmPath), {
            env: make_environment(this)
        });
        this.wasm.instance.exports.main();
    }
    
    stop() {
        this.ctx.clearRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
        this.#reset()
    }

    InitWindow(width, height, title_ptr) {
        this.ctx.canvas.width = width;
        this.ctx.canvas.height = height;
        const buffer = this.wasm.instance.exports.memory.buffer;
        this.platform.updateTitle(cstr_by_ptr(buffer, title_ptr))
    }

    WindowShouldClose() {
        return false;
    }

    SetTargetFPS(fps) {
        this.targetFPS = fps;
    }

    GetScreenWidth() {
        return this.ctx.canvas.width;
    }

    GetScreenHeight() {
        return this.ctx.canvas.height;
    }

    GetFrameTime() {
        // TODO: This is a stopgap solution to prevent sudden jumps in dt when the user switches to a differen tab.
        // We need a proper handling of Target FPS here.
        return Math.min(this.dt, 1.0/this.targetFPS);
    }

    BeginDrawing() {}

    EndDrawing() {
        this.prevPressedKeyState.clear();
        this.prevPressedKeyState = new Set(this.currentPressedKeyState);
        this.currentMouseWheelMoveState = 0.0;
    }

    DrawCircleV(center_ptr, radius, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [x, y] = new Float32Array(buffer, center_ptr, 2);
        const [r, g, b, a] = new Uint8Array(buffer, color_ptr, 4);
        const color = color_hex_unpacked(r, g, b, a);
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2*Math.PI, false);
        this.ctx.fillStyle = color;
        this.ctx.fill();
    }

    ClearBackground(color_ptr) {
        this.ctx.fillStyle = getColorFromMemory(this.wasm.instance.exports.memory.buffer, color_ptr);
        this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
    }

    // RLAPI void DrawText(const char *text, int posX, int posY, int fontSize, Color color);       // Draw text (using default font)
    DrawText(text_ptr, posX, posY, fontSize, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        const color = getColorFromMemory(buffer, color_ptr);
        fontSize *= this.#FONT_SCALE_MAGIC;
        this.ctx.fillStyle = color;
        // TODO: since the default font is part of Raylib the css that defines it should be located in raylib.js and not in index.html
        this.ctx.font = `${fontSize}px grixel`;

        const lines = text.split('\n');
        for (var i = 0; i < lines.length; i++) {
            this.ctx.fillText(lines[i], posX, posY + fontSize + (i * fontSize));
        }
    }

    // RLAPI void DrawRectangle(int posX, int posY, int width, int height, Color color);                        // Draw a color-filled rectangle
    DrawRectangle(posX, posY, width, height, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const color = getColorFromMemory(buffer, color_ptr);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(posX, posY, width, height);
    }

    IsKeyPressed(key) {
        return !this.prevPressedKeyState.has(key) && this.currentPressedKeyState.has(key);
    }
    IsKeyDown(key) {
        return this.currentPressedKeyState.has(key);
    }
    GetMouseWheelMove() {
      return this.currentMouseWheelMoveState;
    }
    IsGestureDetected() {
        return false;
    }

    TextFormat(... args) {
        // TODO: Implement printf style formatting for TextFormat
        return args[0];
    }

    TraceLog(logLevel, text_ptr, ... args) {
        // TODO: Implement printf style formatting for TraceLog
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        this.platform.traceLog(logLevel, text, args);
    }

    GetMousePosition(result_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        new Float32Array(buffer, result_ptr, 2).set([
            this.currentMousePosition.x,
            this.currentMousePosition.y,
        ]);
    }

    CheckCollisionPointRec(point_ptr, rec_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [x, y] = new Float32Array(buffer, point_ptr, 2);
        const [rx, ry, rw, rh] = new Float32Array(buffer, rec_ptr, 4);
        return ((x >= rx) && x <= (rx + rw) && (y >= ry) && y <= (ry + rh));
    }

    Fade(result_ptr, color_ptr, alpha) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [r, g, b, _] = new Uint8Array(buffer, color_ptr, 4);
        const newA = Math.max(0, Math.min(255, 255.0*alpha));
        new Uint8Array(buffer, result_ptr, 4).set([r, g, b, newA]);
    }

    DrawRectangleRec(rec_ptr, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [x, y, w, h] = new Float32Array(buffer, rec_ptr, 4);
        const color = getColorFromMemory(buffer, color_ptr);
        this.ctx.fillStyle = color;
        this.ctx.fillRect(x, y, w, h);
    }

    DrawRectangleLinesEx(rec_ptr, lineThick, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [x, y, w, h] = new Float32Array(buffer, rec_ptr, 4);
        const color = getColorFromMemory(buffer, color_ptr);
        this.ctx.strokeStyle = color;
        this.ctx.lineWidth = lineThick;
        this.ctx.strokeRect(x + lineThick/2, y + lineThick/2, w - lineThick, h - lineThick);
    }

    MeasureText(text_ptr, fontSize) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        fontSize *= this.#FONT_SCALE_MAGIC;
        this.ctx.font = `${fontSize}px grixel`;
        return this.ctx.measureText(text).width;
    }

    TextSubtext(text_ptr, position, length) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        const subtext = text.substring(position, length);

        var bytes = new Uint8Array(buffer, 0, subtext.length+1);
        for(var i = 0; i < subtext.length; i++) {
            bytes[i] = subtext.charCodeAt(i);
        }
        bytes[subtext.length] = 0;

        return bytes;
    }

    // RLAPI Texture2D LoadTexture(const char *fileName);
    LoadTexture(result_ptr, filename_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const filename = cstr_by_ptr(buffer, filename_ptr);

        var result = new Uint32Array(buffer, result_ptr, 5)
        const img = this.platform.loadImage(filename)
        result[0] = this.images.push(img) - 1;
        // TODO: get the true width and height of the image
        result[1] = 256; // width
        result[2] = 256; // height
        result[3] = 1; // mipmaps
        result[4] = 7; // format PIXELFORMAT_UNCOMPRESSED_R8G8B8A8

        return result;
    }

    // RLAPI void DrawTexture(Texture2D texture, int posX, int posY, Color tint);
    DrawTexture(texture_ptr, posX, posY, color_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const [id, width, height, mipmaps, format] = new Uint32Array(buffer, texture_ptr, 5);
        const img = this.images[id];
        switch (img.status) {
            case "loaded":
                // // TODO: implement tinting for DrawTexture
                // const tint = getColorFromMemory(buffer, color_ptr);
                this.ctx.drawImage(img.data, posX, posY);
            case "loading":
                return;
            case "error":
                this.platform.traceLog(LOG_FATAL, `Failed to load image: ${img.error}`);
        }
    }

    // TODO: codepoints are not implemented
    LoadFontEx(result_ptr, fileName_ptr/*, fontSize, codepoints, codepointCount*/) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const fileName = cstr_by_ptr(buffer, fileName_ptr);
        // TODO: dynamically generate the name for the font
        // Support more than one custom font
        const url = `url(${fileName})`;
        const font = new FontFace("myfont", url);
        this.platform.addFont(font, url)
    }

    GenTextureMipmaps() {}
    SetTextureFilter() {}

    MeasureTextEx(result_ptr, font, text_ptr, fontSize, spacing) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        const result = new Float32Array(buffer, result_ptr, 2);
        this.ctx.font = fontSize+"px myfont";
        const metrics = this.ctx.measureText(text)
        result[0] = metrics.width;
        result[1] = fontSize;
    }

    DrawTextEx(font, text_ptr, position_ptr, fontSize, spacing, tint_ptr) {
        const buffer = this.wasm.instance.exports.memory.buffer;
        const text = cstr_by_ptr(buffer, text_ptr);
        const [posX, posY] = new Float32Array(buffer, position_ptr, 2);
        const tint = getColorFromMemory(buffer, tint_ptr);
        this.ctx.fillStyle = tint;
        this.ctx.font = fontSize+"px myfont";
        this.ctx.fillText(text, posX, posY + fontSize);
    }

    raylib_js_set_entry(entry) {
        this.entryFunction = this.wasm.instance.exports.__indirect_function_table.get(entry);
    }
}
