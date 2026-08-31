#include "bspatch_streaming.h"

#include "bzlib/bzlib.h"

#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <fcntl.h>

#define STREAM_CHUNK (64 * 1024)

static int is_cancelled(const struct bs_operation_options *options)
{
    return options != NULL && options->is_cancelled != NULL &&
        options->is_cancelled(options->opaque);
}

static void report_progress(
    const struct bs_operation_options *options,
    int phase,
    double progress)
{
    if (options != NULL && options->progress != NULL)
        options->progress(options->opaque, phase, progress);
}

static int64_t decode_offset(const uint8_t *buffer)
{
    int64_t value = buffer[7] & 0x7f;
    int index;
    for (index = 6; index >= 0; index--)
        value = value * 256 + buffer[index];
    return (buffer[7] & 0x80) != 0 ? -value : value;
}

static int checked_add(int64_t left, int64_t right, int64_t *result)
{
    if ((right > 0 && left > INT64_MAX - right) ||
        (right < 0 && left < INT64_MIN - right))
        return -1;
    *result = left + right;
    return 0;
}

static int read_bzip_exact(
    BZFILE *stream,
    void *buffer,
    size_t length,
    const struct bs_operation_options *options)
{
    size_t offset = 0;
    while (offset < length) {
        int error;
        int chunk = length - offset > INT_MAX
            ? INT_MAX
            : (int)(length - offset);
        int count;
        if (is_cancelled(options))
            return BS_OPERATION_CANCELLED;
        count = BZ2_bzRead(
            &error,
            stream,
            (uint8_t *)buffer + offset,
            chunk);
        if (count != chunk || (error != BZ_OK && error != BZ_STREAM_END))
            return BS_OPERATION_ERROR;
        offset += (size_t)count;
    }
    return BS_OPERATION_OK;
}

static int read_old_exact(int fd, void *buffer, size_t length)
{
    size_t offset = 0;
    while (offset < length) {
        ssize_t count = read(fd, (uint8_t *)buffer + offset, length - offset);
        if (count <= 0)
            return BS_OPERATION_ERROR;
        offset += (size_t)count;
    }
    return BS_OPERATION_OK;
}

static int write_exact(
    int fd,
    const void *buffer,
    size_t length,
    const struct bs_operation_options *options)
{
    size_t offset = 0;
    while (offset < length) {
        ssize_t count;
        if (is_cancelled(options))
            return BS_OPERATION_CANCELLED;
        count = write(fd, (const uint8_t *)buffer + offset, length - offset);
        if (count <= 0)
            return BS_OPERATION_ERROR;
        offset += (size_t)count;
    }
    return BS_OPERATION_OK;
}

static int add_old_bytes(
    int old_fd,
    int64_t old_size,
    int64_t old_position,
    uint8_t *diff,
    uint8_t *old,
    size_t length)
{
    int64_t block_end;
    int64_t overlap_start;
    int64_t overlap_end;
    size_t overlap_offset;
    size_t overlap_length;
    size_t index;

    if (checked_add(old_position, (int64_t)length, &block_end) != 0)
        return BS_OPERATION_ERROR;
    memset(old, 0, length);
    overlap_start = old_position < 0 ? 0 : old_position;
    overlap_end = block_end > old_size ? old_size : block_end;
    if (overlap_start >= overlap_end)
        return BS_OPERATION_OK;
    overlap_offset = (size_t)(overlap_start - old_position);
    overlap_length = (size_t)(overlap_end - overlap_start);
    if (lseek(old_fd, (off_t)overlap_start, SEEK_SET) < 0)
        return BS_OPERATION_ERROR;
    if (read_old_exact(old_fd, old + overlap_offset, overlap_length) !=
        BS_OPERATION_OK)
        return BS_OPERATION_ERROR;
    for (index = 0; index < length; index++)
        diff[index] = (uint8_t)(diff[index] + old[index]);
    return BS_OPERATION_OK;
}

int bsPatchFileStreamingToFd(
    const char *old_file,
    const char *patch_file,
    int output_fd,
    const struct bs_operation_options *options)
{
    FILE *patch = NULL;
    BZFILE *compressed = NULL;
    int old_fd = -1;
    int bz_error = BZ_OK;
    int result = BS_OPERATION_ERROR;
    struct stat file_stat;
    uint8_t header[24];
    uint8_t control_buffer[8];
    uint8_t *diff_buffer = NULL;
    uint8_t *old_buffer = NULL;
    int64_t control[3];
    int64_t old_size;
    int64_t new_size;
    int64_t old_position = 0;
    int64_t new_position = 0;

    if (old_file == NULL || patch_file == NULL || output_fd < 0)
        goto cleanup;
    if (is_cancelled(options)) {
        result = BS_OPERATION_CANCELLED;
        goto cleanup;
    }

    report_progress(options, BS_OPERATION_READING, 0.0);
    patch = fopen(patch_file, "rb");
    if (patch == NULL || fstat(fileno(patch), &file_stat) != 0 ||
        file_stat.st_size < 24)
        goto cleanup;
    if (bs_operation_has_input_limit(options) &&
        file_stat.st_size > options->max_input_bytes) {
        result = BS_OPERATION_INPUT_TOO_LARGE;
        goto cleanup;
    }
    if (fread(header, 1, sizeof(header), patch) != sizeof(header) ||
        memcmp(header, "ENDSLEY/BSDIFF43", 16) != 0)
        goto cleanup;
    new_size = decode_offset(header + 16);
    if (new_size < 0) {
        result = BS_OPERATION_ERROR;
        goto cleanup;
    }
    if (bs_operation_has_output_limit(options) &&
        new_size > options->max_output_bytes) {
        result = BS_OPERATION_OUTPUT_TOO_LARGE;
        goto cleanup;
    }
    report_progress(options, BS_OPERATION_READING, 0.05);

    old_fd = open(old_file, O_RDONLY);
    if (old_fd < 0 || fstat(old_fd, &file_stat) != 0 ||
        file_stat.st_size < 0)
        goto cleanup;
    old_size = (int64_t)file_stat.st_size;
    if (bs_operation_has_input_limit(options) &&
        old_size > options->max_input_bytes) {
        result = BS_OPERATION_INPUT_TOO_LARGE;
        goto cleanup;
    }
    report_progress(options, BS_OPERATION_READING, 0.15);

    diff_buffer = malloc(STREAM_CHUNK);
    old_buffer = malloc(STREAM_CHUNK);
    if (diff_buffer == NULL || old_buffer == NULL)
        goto cleanup;

    compressed = BZ2_bzReadOpen(&bz_error, patch, 0, 1, NULL, 0);
    if (compressed == NULL || bz_error != BZ_OK)
        goto cleanup;

    while (new_position < new_size) {
        int index;
        int64_t next_old_position;
        int64_t processed;

        if (is_cancelled(options)) {
            result = BS_OPERATION_CANCELLED;
            goto cleanup;
        }
        for (index = 0; index < 3; index++) {
            result = read_bzip_exact(
                compressed,
                control_buffer,
                sizeof(control_buffer),
                options);
            if (result != BS_OPERATION_OK)
                goto cleanup;
            control[index] = decode_offset(control_buffer);
        }
        if (control[0] < 0 || control[1] < 0 ||
            control[0] > new_size - new_position ||
            checked_add(old_position, control[0], &next_old_position) != 0) {
            result = BS_OPERATION_ERROR;
            goto cleanup;
        }
        if (control[0] == 0 && control[1] == 0) {
            result = BS_OPERATION_ERROR;
            goto cleanup;
        }

        processed = 0;
        while (processed < control[0]) {
            size_t chunk = (size_t)(control[0] - processed);
            int64_t block_old_position;
            if (chunk > STREAM_CHUNK)
                chunk = STREAM_CHUNK;
            result = read_bzip_exact(
                compressed,
                diff_buffer,
                chunk,
                options);
            if (result != BS_OPERATION_OK)
                goto cleanup;
            if (checked_add(
                    old_position,
                    processed,
                    &block_old_position) != 0 ||
                add_old_bytes(
                    old_fd,
                    old_size,
                    block_old_position,
                    diff_buffer,
                    old_buffer,
                    chunk) != BS_OPERATION_OK) {
                result = BS_OPERATION_ERROR;
                goto cleanup;
            }
            result = write_exact(
                output_fd,
                diff_buffer,
                chunk,
                options);
            if (result != BS_OPERATION_OK)
                goto cleanup;
            processed += (int64_t)chunk;
            new_position += (int64_t)chunk;
        }
        old_position = next_old_position;

        if (control[1] > new_size - new_position) {
            result = BS_OPERATION_ERROR;
            goto cleanup;
        }
        processed = 0;
        while (processed < control[1]) {
            size_t chunk = (size_t)(control[1] - processed);
            if (chunk > STREAM_CHUNK)
                chunk = STREAM_CHUNK;
            result = read_bzip_exact(
                compressed,
                diff_buffer,
                chunk,
                options);
            if (result != BS_OPERATION_OK)
                goto cleanup;
            result = write_exact(
                output_fd,
                diff_buffer,
                chunk,
                options);
            if (result != BS_OPERATION_OK)
                goto cleanup;
            processed += (int64_t)chunk;
            new_position += (int64_t)chunk;
        }
        if (checked_add(
                old_position,
                control[2],
                &next_old_position) != 0) {
            result = BS_OPERATION_ERROR;
            goto cleanup;
        }
        old_position = next_old_position;
        report_progress(
            options,
            BS_OPERATION_PROCESSING,
            new_size == 0
                ? 0.85
                : 0.15 + 0.70 *
                    ((double)new_position / (double)new_size));
    }

    if (fsync(output_fd) != 0)
        goto cleanup;
    report_progress(options, BS_OPERATION_WRITING, 0.95);
    result = BS_OPERATION_OK;

cleanup:
    if (compressed != NULL)
        BZ2_bzReadClose(&bz_error, compressed);
    if (patch != NULL)
        fclose(patch);
    if (old_fd >= 0)
        close(old_fd);
    if (output_fd >= 0 && close(output_fd) != 0 &&
        result == BS_OPERATION_OK)
        result = BS_OPERATION_ERROR;
    free(diff_buffer);
    free(old_buffer);
    return result;
}
