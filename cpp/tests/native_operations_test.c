#ifdef __APPLE__
#ifndef _DARWIN_C_SOURCE
#define _DARWIN_C_SOURCE
#endif
#else
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#endif

#include "bsdiff.h"
#include "bsdiff40_converter.h"
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

static void encode_offset(int64_t value, uint8_t *buffer)
{
    int64_t magnitude = value < 0 ? -value : value;
    int index;
    for (index = 0; index < 8; index++) {
        buffer[index] = (uint8_t)(magnitude & 0xff);
        magnitude >>= 8;
    }
    if (value < 0)
        buffer[7] |= 0x80;
}

static int write_bzip_block(FILE *file, const uint8_t *data, int length)
{
    int error;
    BZFILE *stream = BZ2_bzWriteOpen(&error, file, 9, 0, 0);
    if (stream == NULL || error != BZ_OK)
        return -1;
    if (length > 0) {
        BZ2_bzWrite(&error, stream, (void *)data, length);
        if (error != BZ_OK) {
            BZ2_bzWriteClose(&error, stream, 1, NULL, NULL);
            return -1;
        }
    }
    BZ2_bzWriteClose(&error, stream, 0, NULL, NULL);
    return error == BZ_OK ? 0 : -1;
}

static int write_bsdiff40_fixture(
    const char *path,
    const char *target_path)
{
    FILE *target = NULL;
    FILE *patch = NULL;
    uint8_t *target_data = NULL;
    uint8_t header[32];
    uint8_t control[24];
    long control_end;
    long diff_end;
    int result = -1;

    memset(header, 0, sizeof(header));
    memset(control, 0, sizeof(control));
    target_data = malloc(FIXTURE_SIZE);
    target = fopen(target_path, "rb");
    patch = fopen(path, "wb+");
    if (target_data == NULL || target == NULL || patch == NULL ||
        fread(target_data, 1, FIXTURE_SIZE, target) != FIXTURE_SIZE ||
        fwrite(header, 1, sizeof(header), patch) != sizeof(header))
        goto cleanup;
    encode_offset(FIXTURE_SIZE, control + 8);
    if (write_bzip_block(patch, control, sizeof(control)) != 0)
        goto cleanup;
    control_end = ftell(patch);
    if (control_end < 32 || write_bzip_block(patch, NULL, 0) != 0)
        goto cleanup;
    diff_end = ftell(patch);
    if (diff_end < control_end ||
        write_bzip_block(patch, target_data, FIXTURE_SIZE) != 0)
        goto cleanup;

    memcpy(header, "BSDIFF40", 8);
    encode_offset(control_end - 32, header + 8);
    encode_offset(diff_end - control_end, header + 16);
    encode_offset(FIXTURE_SIZE, header + 24);
    if (fseek(patch, 0, SEEK_SET) != 0 ||
        fwrite(header, 1, sizeof(header), patch) != sizeof(header))
        goto cleanup;
    result = 0;

cleanup:
    if (target != NULL)
        fclose(target);
    if (patch != NULL && fclose(patch) != 0)
        result = -1;
    free(target_data);
    return result;
}

static int write_nonprogress_patch(const char *path)
{
    FILE *patch = NULL;
    uint8_t header[24];
    uint8_t control[24];
    int result = -1;

    memset(header, 0, sizeof(header));
    memset(control, 0, sizeof(control));
    memcpy(header, "ENDSLEY/BSDIFF43", 16);
    encode_offset(1, header + 16);
    patch = fopen(path, "wb");
    if (patch == NULL ||
        fwrite(header, 1, sizeof(header), patch) != sizeof(header) ||
        write_bzip_block(patch, control, sizeof(control)) != 0)
        goto cleanup;
    result = 0;

cleanup:
    if (patch != NULL && fclose(patch) != 0)
        result = -1;
    return result;
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
    char cancelledPatchOutputPath[512];
    char corruptPatchPath[512];
    char corruptOutputPath[512];
    char racedPath[512];
    char legacyPatchPath[512];
    char legacyRestoredPath[512];
    char bsdiff40PatchPath[512];
    char convertedPatchPath[512];
    char convertedRestoredPath[512];
    char nonprogressPatchPath[512];
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
    snprintf(
        cancelledPatchOutputPath,
        sizeof(cancelledPatchOutputPath),
        "%s/cancelled-output.bin",
        directory);
    snprintf(corruptPatchPath, sizeof(corruptPatchPath), "%s/corrupt.patch", directory);
    snprintf(corruptOutputPath, sizeof(corruptOutputPath), "%s/corrupt-output.bin", directory);
    snprintf(racedPath, sizeof(racedPath), "%s/raced.patch", directory);
    snprintf(legacyPatchPath, sizeof(legacyPatchPath), "%s/legacy.patch", directory);
    snprintf(legacyRestoredPath, sizeof(legacyRestoredPath), "%s/legacy-restored.bin", directory);
    snprintf(bsdiff40PatchPath, sizeof(bsdiff40PatchPath), "%s/legacy-bsdiff40.patch", directory);
    snprintf(convertedPatchPath, sizeof(convertedPatchPath), "%s/converted.patch", directory);
    snprintf(convertedRestoredPath, sizeof(convertedRestoredPath), "%s/converted.bin", directory);
    snprintf(nonprogressPatchPath, sizeof(nonprogressPatchPath), "%s/nonprogress.patch", directory);
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
    CHECK(write_nonprogress_patch(nonprogressPatchPath) == 0,
        "non-progress patch creation failed");
    CHECK(bsPatchFile(oldPath, corruptOutputPath, nonprogressPatchPath) != BS_OPERATION_OK,
        "non-progress patch was accepted");
    CHECK(access(corruptOutputPath, F_OK) != 0,
        "non-progress patch committed an output");
    CHECK(bsDiffFile(oldPath, newPath, legacyPatchPath) == BS_OPERATION_OK,
        "legacy diff failed");
    CHECK(bsPatchFile(oldPath, legacyRestoredPath, legacyPatchPath) == BS_OPERATION_OK,
        "legacy patch failed");
    CHECK(files_equal(newPath, legacyRestoredPath),
        "legacy round trip differs from fixture");

    CHECK(write_bsdiff40_fixture(bsdiff40PatchPath, newPath) == 0,
        "BSDIFF40 fixture creation failed");
    CHECK(bsConvertBsdiff40File(bsdiff40PatchPath, convertedPatchPath) == 0,
        "BSDIFF40 conversion failed");
    CHECK(bsPatchFile(oldPath, convertedRestoredPath, convertedPatchPath) ==
        BS_OPERATION_OK, "converted patch could not be applied");
    CHECK(files_equal(newPath, convertedRestoredPath),
        "converted BSDIFF40 patch differs from target");

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
    options = options_for(&state);
    options.max_input_bytes = 0;
    options.limit_flags = BS_OPERATION_LIMIT_INPUT;
    result = bsDiffFileWithOptions(oldPath, newPath, limitedPath, &options);
    CHECK(result == BS_OPERATION_INPUT_TOO_LARGE,
        "explicit zero input limit returned the wrong status");
    CHECK(access(limitedPath, F_OK) != 0,
        "explicit zero input limit committed an output");

    memset(&state, 0, sizeof(state));
    options = options_for(&state);
    options.max_output_bytes = 0;
    options.limit_flags = BS_OPERATION_LIMIT_OUTPUT;
    result = bsDiffFileWithOptions(oldPath, newPath, limitedPath, &options);
    CHECK(result == BS_OPERATION_OUTPUT_TOO_LARGE,
        "explicit zero diff output limit returned the wrong status");
    CHECK(access(limitedPath, F_OK) != 0,
        "explicit zero diff output limit committed an output");

    memset(&state, 0, sizeof(state));
    options = options_for(&state);
    options.max_output_bytes = 0;
    options.limit_flags = BS_OPERATION_LIMIT_OUTPUT;
    result = bsPatchFileWithOptions(oldPath, limitedPath, patchPath, &options);
    CHECK(result == BS_OPERATION_OUTPUT_TOO_LARGE,
        "explicit zero patch output limit returned the wrong status");
    CHECK(access(limitedPath, F_OK) != 0,
        "explicit zero patch output limit committed an output");

    memset(&state, 0, sizeof(state));
    state.cancel_during_processing = 1;
    state.last_phase = -1;
    state.monotonic = 1;
    options = options_for(&state);
    result = bsDiffFileWithOptions(oldPath, newPath, cancelledPath, &options);
    CHECK(result == BS_OPERATION_CANCELLED, "cancellation returned the wrong status");
    CHECK(access(cancelledPath, F_OK) != 0, "cancelled operation committed an output");
    CHECK(!has_temporary_output(directory), "cancelled operation leaked a temporary file");

    memset(&state, 0, sizeof(state));
    state.cancel_during_processing = 1;
    state.last_phase = -1;
    state.monotonic = 1;
    options = options_for(&state);
    result = bsPatchFileStreamingWithOptions(
        oldPath,
        cancelledPatchOutputPath,
        patchPath,
        &options);
    CHECK(result == BS_OPERATION_CANCELLED,
        "streaming patch cancellation returned the wrong status");
    CHECK(access(cancelledPatchOutputPath, F_OK) != 0,
        "cancelled streaming patch committed an output");
    CHECK(!has_temporary_output(directory),
        "cancelled streaming patch leaked a temporary file");

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
    unlink(legacyPatchPath);
    unlink(legacyRestoredPath);
    unlink(bsdiff40PatchPath);
    unlink(convertedPatchPath);
    unlink(convertedRestoredPath);
    unlink(nonprogressPatchPath);
    CHECK(rmdir(directory) == 0, "temporary directory cleanup failed");
    printf("native operation controls: ok\n");
    return 0;
}
