#define NOB_IMPLEMENTATION
#include "nob.h"

typedef struct {
    const char *src_path;
    const char *bin_path;
    const char *wasm_path;
    const char *native_wasm_path;
} Example;

Example examples[] = {
    {
        .src_path   = "./examples/core_basic_window.c",
        .bin_path   = "./build/core_basic_window",
        .wasm_path  = "./wasm/core_basic_window.wasm",
        .native_wasm_path = "./wasm/core_basic_window.native.wasm"
    },
    {
        .src_path   = "./examples/core_basic_screen_manager.c",
        .bin_path   = "./build/core_basic_screen_manager",
        .wasm_path  = "./wasm/core_basic_screen_manager.wasm",
        .native_wasm_path = "./wasm/core_basic_screen_manager.native.wasm"
    },
    {
        .src_path   = "./examples/core_input_keys.c",
        .bin_path   = "./build/core_input_keys",
        .wasm_path  = "./wasm/core_input_keys.wasm",
        .native_wasm_path = "./wasm/core_input_keys.native.wasm"
    },
    {
        .src_path   = "./examples/shapes_colors_palette.c",
        .bin_path   = "./build/shapes_colors_palette",
        .wasm_path  = "./wasm/shapes_colors_palette.wasm",
        .native_wasm_path = "./wasm/shapes_colors_palette.native.wasm"
    },
    {
        .src_path   = "./examples/tsoding_ball.c",
        .bin_path = "./build/tsoding_ball",
        .wasm_path  = "./wasm/tsoding_ball.wasm",
        .native_wasm_path = "./wasm/tsoding_ball.native.wasm"
    },
    {
        .src_path   = "./examples/tsoding_snake/tsoding_snake.c",
        .bin_path = "./build/tsoding_snake",
        .wasm_path  = "./wasm/tsoding_snake.wasm",
        .native_wasm_path = "./wasm/tsoding_snake.native.wasm"
    },
    {
        .src_path   = "./examples/core_input_mouse_wheel.c",
        .bin_path   = "./build/core_input_mouse_wheel",
        .wasm_path  = "./wasm/core_input_mouse_wheel.wasm",
        .native_wasm_path = "./wasm/core_input_mouse_wheel.native.wasm"
    },
    {
        .src_path   = "./examples/text_writing_anim.c",
        .bin_path   = "./build/text_writing_anim",
        .wasm_path  = "./wasm/text_writing_anim.wasm",
        .native_wasm_path = "./wasm/text_writing_anim.native.wasm"
    },
    {
        .src_path   = "./examples/textures_logo_raylib.c",
        .bin_path   = "./build/textures_logo_raylib",
        .wasm_path  = "./wasm/textures_logo_raylib.wasm",
        .native_wasm_path = "./wasm/textures_logo_raylib.native.wasm"
    },
};

bool build_native(void)
{
    Nob_Cmd cmd = {0};
    for (size_t i = 0; i < NOB_ARRAY_LEN(examples); ++i) {
        cmd.count = 0;
        nob_cmd_append(&cmd, "clang", "-I./include/");
        nob_cmd_append(&cmd, "-o", examples[i].bin_path, examples[i].src_path);
        nob_cmd_append(&cmd, "-L./lib/", "-lraylib", "-lm");
        if (!nob_cmd_run_sync(cmd)) return 1;
    }
}

bool build_wasm(void)
{
    Nob_Cmd cmd = {0};
    for (size_t i = 0; i < NOB_ARRAY_LEN(examples); ++i) {
        cmd.count = 0;
        nob_cmd_append(&cmd, "clang");
        nob_cmd_append(&cmd, "--target=wasm32");
        nob_cmd_append(&cmd, "-I./include");
        nob_cmd_append(&cmd, "--no-standard-libraries");
        nob_cmd_append(&cmd, "-Wl,--export-table");
        nob_cmd_append(&cmd, "-Wl,--no-entry");
        nob_cmd_append(&cmd, "-Wl,--allow-undefined");
        nob_cmd_append(&cmd, "-Wl,--export=main");
        nob_cmd_append(&cmd, "-o");
        nob_cmd_append(&cmd, examples[i].wasm_path);
        nob_cmd_append(&cmd, examples[i].src_path);
        nob_cmd_append(&cmd, "-DPLATFORM_WEB");
        if (!nob_cmd_run_sync(cmd)) return 1;
    }
}

bool build_native_wasm(void)
{
    Nob_Cmd cmd = {0};
    for (size_t i = 0; i < NOB_ARRAY_LEN(examples); ++i) {
        cmd.count = 0;
        nob_cmd_append(&cmd, "clang");
        nob_cmd_append(&cmd, "--target=wasm32");
        nob_cmd_append(&cmd, "-I./include");
        nob_cmd_append(&cmd, "--no-standard-libraries");
        nob_cmd_append(&cmd, "-Wl,--export-table");
        nob_cmd_append(&cmd, "-Wl,--no-entry");
        nob_cmd_append(&cmd, "-Wl,--allow-undefined");
        nob_cmd_append(&cmd, "-Wl,--export=main");
        nob_cmd_append(&cmd, "-o");
        nob_cmd_append(&cmd, examples[i].native_wasm_path);
        nob_cmd_append(&cmd, examples[i].src_path);
        if (!nob_cmd_run_sync(cmd)) return 1;
    }
}

int main(int argc, char **argv)
{
    NOB_GO_REBUILD_URSELF(argc, argv);
    if (!nob_mkdir_if_not_exists("build/")) return 1;
    build_native();
    build_wasm();
    build_native_wasm();
    return 0;
}
