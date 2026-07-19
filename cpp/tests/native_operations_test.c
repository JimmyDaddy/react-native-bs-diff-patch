#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "bsdiffpatch_operation.h"
#include "bspatch.h"

#include <dirent.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

#define FIXTURE_SIZE (256 * 1024)

struct callback_state {
    int cancelled;
    int cancel_during_processing;
    int callback_count;
    int last_phase;
    double last_progress;
    int monotonic;
    const char *concurrent_destination;
};

static int fail(const char *message, int line)
{
    fprintf(stderr, "native operation test failed at line %d: %s\n", line, message);
    return 1;
}

#define CHECK(condition, message) do { if (!(condition)) return fail((message), __LINE__); } while (0)

static int is_cancelled(void *opaque)
{
    struct callback_state *state = opaque;
    return state->cancelled;
}

static void on_progress(void *opaque, int phase, double progress)
{
    struct callback_state *state = opaque;
    if (state->callback_count > 0 &&
        (phase < state->last_phase || progress < state->last_progress))
        state->monotonic = 0;
    state->callback_count++;
    state->last_phase = phase;
    state->last_progress = progress;
    if (state->cancel_during_processing && phase == BS_OPERATION_PROCESSING)
        state->cancelled = 1;
    if (state->concurrent_destination != NULL &&
        phase == BS_OPERATION_WRITING && progress >= 0.95) {
        FILE *file = fopen(state->concurrent_destination, "wb");
        const char marker[] = "concurrent destination";
        if (file != NULL) {
            fwrite(marker, 1, sizeof(marker), file);
            fclose(file);
        }
        state->concurrent_destination = NULL;
    }
}

static int write_fixture(const char *path, int modified)
{
    FILE *file = fopen(path, "wb");
    uint8_t buffer[4096];
    size_t offset;
    if (file == NULL)
        return -1;
    for (offset = 0; offset < FIXTURE_SIZE; offset += sizeof(buffer)) {
        size_t index;
        for (index = 0; index < sizeof(buffer); index++) {
            size_t absolute = offset + index;
            uint8_t value = (uint8_t)((absolute * 31 + (absolute >> 8)) & 0xff);
            if (modified && absolute % 4096 == 0)
                value ^= 0x5a;
            buffer[index] = value;
        }
        if (fwrite(buffer, 1, sizeof(buffer), file) != sizeof(buffer)) {
            fclose(file);
            return -1;
        }
    }
    return fclose(file);
}

static int files_equal(const char *leftPath, const char *rightPath)
{
    FILE *left = fopen(leftPath, "rb");
    FILE *right = fopen(rightPath, "rb");
    uint8_t leftBuffer[4096];
    uint8_t rightBuffer[4096];
    int equal = 0;
    if (left == NULL || right == NULL)
        goto cleanup;
    for (;;) {
        size_t leftCount = fread(leftBuffer, 1, sizeof(leftBuffer), left);
        size_t rightCount = fread(rightBuffer, 1, sizeof(rightBuffer), right);
        if (leftCount != rightCount ||
            memcmp(leftBuffer, rightBuffer, leftCount) != 0)
            goto cleanup;
        if (leftCount == 0) {
            equal = feof(left) && feof(right);
            break;
        }
    }
cleanup:
    if (left != NULL) fclose(left);
    if (right != NULL) fclose(right);
    return equal;
}

static int has_temporary_output(const char *directory)
{
    DIR *entries = opendir(directory);
    struct dirent *entry;
    int found = 0;
    if (entries == NULL)
        return 1;
    while ((entry = readdir(entries)) != NULL) {
        if (strstr(entry->d_name, ".bsdiffpatch.") != NULL) {
            found = 1;
            break;
        }
    }
    closedir(entries);
    return found;
}

static struct bs_operation_options options_for(struct callback_state *state)
{
    struct bs_operation_options options;
    memset(&options, 0, sizeof(options));
    options.max_input_bytes = FIXTURE_SIZE * 2;
    options.max_output_bytes = FIXTURE_SIZE * 2;
    options.opaque = state;
    options.is_cancelled = is_cancelled;
    options.progress = on_progress;
    return options;
}

int main(void)
{
    char directoryTemplate[] = "/tmp/bsdiffpatch-operations-XXXXXX";
    char oldPath[512];
    char newPath[512];
    char patchPath[512];
    char restoredPath[512];
    char limitedPath[512];
    char cancelledPath[512];
    char corruptPatchPath[512];
    char corruptOutputPath[512];
    char racedPath[512];
    char *directory = mkdtemp(directoryTemplate);
    struct callback_state state;
    struct bs_operation_options options;
    int result;

    CHECK(directory != NULL, "mkdtemp failed");
    snprintf(oldPath, sizeof(oldPath), "%s/old.bin", directory);
    snprintf(newPath, sizeof(newPath), "%s/new.bin", directory);
    snprintf(patchPath, sizeof(patchPath), "%s/change.patch", directory);
    snprintf(restoredPath, sizeof(restoredPath), "%s/restored.bin", directory);
    snprintf(limitedPath, sizeof(limitedPath), "%s/limited.bin", directory);
    snprintf(cancelledPath, sizeof(cancelledPath), "%s/cancelled.patch", directory);
    snprintf(corruptPatchPath, sizeof(corruptPatchPath), "%s/corrupt.patch", directory);
    snprintf(corruptOutputPath, sizeof(corruptOutputPath), "%s/corrupt-output.bin", directory);
    snprintf(racedPath, sizeof(racedPath), "%s/raced.patch", directory);
    CHECK(write_fixture(oldPath, 0) == 0, "old fixture creation failed");
    CHECK(write_fixture(newPath, 1) == 0, "new fixture creation failed");

    {
        FILE *corruptPatch = fopen(corruptPatchPath, "wb");
        const char invalidPatch[] = "not a bsdiff patch";
        CHECK(corruptPatch != NULL, "corrupt patch creation failed");
        CHECK(fwrite(invalidPatch, 1, sizeof(invalidPatch), corruptPatch) == sizeof(invalidPatch),
            "corrupt patch write failed");
        CHECK(fclose(corruptPatch) == 0, "corrupt patch close failed");
    }
    CHECK(bsPatchFile(oldPath, corruptOutputPath, corruptPatchPath) != BS_OPERATION_OK,
        "legacy patch accepted malformed input");
    CHECK(access(corruptOutputPath, F_OK) != 0,
        "legacy malformed patch committed an output");

    memset(&state, 0, sizeof(state));
    state.last_phase = -1;
    state.monotonic = 1;
    options = options_for(&state);
    result = bsDiffFileWithOptions(oldPath, newPath, patchPath, &options);
    CHECK(result == BS_OPERATION_OK, "limited diff did not succeed");
    CHECK(state.callback_count > 2 && state.monotonic, "diff progress was not monotonic");
    CHECK(access(patchPath, F_OK) == 0, "diff output was not committed");

    memset(&state, 0, sizeof(state));
    state.last_phase = -1;
    state.monotonic = 1;
    options = options_for(&state);
    result = bsPatchFileWithOptions(oldPath, restoredPath, patchPath, &options);
    CHECK(result == BS_OPERATION_OK, "limited patch did not succeed");
    CHECK(files_equal(newPath, restoredPath), "patched output differs from fixture");
    CHECK(state.callback_count > 2 && state.monotonic, "patch progress was not monotonic");

    memset(&state, 0, sizeof(state));
    options = options_for(&state);
    options.max_input_bytes = 1024;
    result = bsDiffFileWithOptions(oldPath, newPath, limitedPath, &options);
    CHECK(result == BS_OPERATION_INPUT_TOO_LARGE, "input limit returned the wrong status");
    CHECK(access(limitedPath, F_OK) != 0, "input limit committed an output");

    memset(&state, 0, sizeof(state));
    options = options_for(&state);
    options.max_output_bytes = FIXTURE_SIZE - 1;
    result = bsPatchFileWithOptions(oldPath, limitedPath, patchPath, &options);
    CHECK(result == BS_OPERATION_OUTPUT_TOO_LARGE, "output limit returned the wrong status");
    CHECK(access(limitedPath, F_OK) != 0, "output limit committed an output");

    memset(&state, 0, sizeof(state));
    state.cancel_during_processing = 1;
    state.last_phase = -1;
    state.monotonic = 1;
    options = options_for(&state);
    result = bsDiffFileWithOptions(oldPath, newPath, cancelledPath, &options);
    CHECK(result == BS_OPERATION_CANCELLED, "cancellation returned the wrong status");
    CHECK(access(cancelledPath, F_OK) != 0, "cancelled operation committed an output");
    CHECK(!has_temporary_output(directory), "cancelled operation leaked a temporary file");

    CHECK(write_fixture(limitedPath, 0) == 0, "destination fixture creation failed");
    memset(&state, 0, sizeof(state));
    options = options_for(&state);
    result = bsPatchFileWithOptions(oldPath, limitedPath, patchPath, &options);
    CHECK(result == BS_OPERATION_DESTINATION_EXISTS, "existing destination returned the wrong status");
    CHECK(files_equal(oldPath, limitedPath), "existing destination was modified");

    memset(&state, 0, sizeof(state));
    state.last_phase = -1;
    state.monotonic = 1;
    state.concurrent_destination = racedPath;
    options = options_for(&state);
    result = bsDiffFileWithOptions(oldPath, newPath, racedPath, &options);
    CHECK(result == BS_OPERATION_DESTINATION_EXISTS,
        "concurrent destination returned the wrong status");
    CHECK(access(racedPath, F_OK) == 0,
        "concurrent destination disappeared during commit");
    CHECK(!has_temporary_output(directory),
        "concurrent destination commit leaked a temporary file");

    unlink(limitedPath);
    unlink(restoredPath);
    unlink(patchPath);
    unlink(newPath);
    unlink(oldPath);
    unlink(corruptPatchPath);
    unlink(racedPath);
    CHECK(rmdir(directory) == 0, "temporary directory cleanup failed");
    printf("native operation controls: ok\n");
    return 0;
}
