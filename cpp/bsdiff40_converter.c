#include "bsdiff40_converter.h"

#include "bzlib/bzlib.h"

#include <errno.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <fcntl.h>

#define CONVERTER_CHUNK (64 * 1024)

static int64_t decode_offset(const uint8_t *buffer)
{
    int64_t value = buffer[7] & 0x7f;
    int index;
    for (index = 6; index >= 0; index--)
        value = value * 256 + buffer[index];
    return (buffer[7] & 0x80) != 0 ? -value : value;
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

static int checked_add(int64_t left, int64_t right, int64_t *result)
{
    if ((right > 0 && left > INT64_MAX - right) ||
        (right < 0 && left < INT64_MIN - right))
        return -1;
    *result = left + right;
    return 0;
}

static int read_exact(BZFILE *stream, void *buffer, int length)
{
    int offset = 0;
    while (offset < length) {
        int error;
        int count = BZ2_bzRead(
            &error,
            stream,
            (uint8_t *)buffer + offset,
            length - offset);
        if (count <= 0 || (error != BZ_OK && error != BZ_STREAM_END))
            return -1;
        offset += count;
    }
    return 0;
}

static int write_exact(BZFILE *stream, const void *buffer, int length)
{
    int error;
    BZ2_bzWrite(&error, stream, (void *)buffer, length);
    return error == BZ_OK ? 0 : -1;
}

static int copy_bytes(BZFILE *input, BZFILE *output, int64_t length)
{
    uint8_t buffer[CONVERTER_CHUNK];
    int64_t offset = 0;
    while (offset < length) {
        int chunk = length - offset > CONVERTER_CHUNK
            ? CONVERTER_CHUNK
            : (int)(length - offset);
        if (read_exact(input, buffer, chunk) != 0 ||
            write_exact(output, buffer, chunk) != 0)
            return -1;
        offset += chunk;
    }
    return 0;
}

static FILE *open_at(const char *path, int64_t offset)
{
    FILE *file = fopen(path, "rb");
    if (file == NULL)
        return NULL;
    if (fseeko(file, (off_t)offset, SEEK_SET) != 0) {
        fclose(file);
        return NULL;
    }
    return file;
}

int bsConvertBsdiff40File(
    const char *legacy_patch_file,
    const char *patch_file)
{
    FILE *header_file = NULL;
    FILE *control_file = NULL;
    FILE *diff_file = NULL;
    FILE *extra_file = NULL;
    FILE *output_file = NULL;
    BZFILE *control_stream = NULL;
    BZFILE *diff_stream = NULL;
    BZFILE *extra_stream = NULL;
    BZFILE *output_stream = NULL;
    int output_fd = -1;
    int bz_error = BZ_OK;
    int result = -1;
    int output_created = 0;
    struct stat patch_stat;
    uint8_t header[32];
    uint8_t target_size_buffer[8];
    uint8_t control_buffer[24];
    int64_t control_length;
    int64_t diff_length;
    int64_t target_size;
    int64_t target_position = 0;
    int64_t old_position = 0;
    int64_t block_offset;

    if (legacy_patch_file == NULL || patch_file == NULL)
        goto cleanup;
    header_file = fopen(legacy_patch_file, "rb");
    if (header_file == NULL ||
        fstat(fileno(header_file), &patch_stat) != 0 ||
        fread(header, 1, sizeof(header), header_file) != sizeof(header) ||
        memcmp(header, "BSDIFF40", 8) != 0)
        goto cleanup;
    control_length = decode_offset(header + 8);
    diff_length = decode_offset(header + 16);
    target_size = decode_offset(header + 24);
    if (control_length <= 0 || diff_length <= 0 || target_size < 0 ||
        checked_add(32, control_length, &block_offset) != 0 ||
        checked_add(block_offset, diff_length, &block_offset) != 0 ||
        block_offset >= patch_stat.st_size)
        goto cleanup;
    fclose(header_file);
    header_file = NULL;

    control_file = open_at(legacy_patch_file, 32);
    diff_file = open_at(legacy_patch_file, 32 + control_length);
    extra_file = open_at(
        legacy_patch_file,
        32 + control_length + diff_length);
    if (control_file == NULL || diff_file == NULL || extra_file == NULL)
        goto cleanup;
    control_stream = BZ2_bzReadOpen(
        &bz_error,
        control_file,
        0,
        1,
        NULL,
        0);
    if (control_stream == NULL || bz_error != BZ_OK)
        goto cleanup;
    diff_stream = BZ2_bzReadOpen(
        &bz_error,
        diff_file,
        0,
        1,
        NULL,
        0);
    if (diff_stream == NULL || bz_error != BZ_OK)
        goto cleanup;
    extra_stream = BZ2_bzReadOpen(
        &bz_error,
        extra_file,
        0,
        1,
        NULL,
        0);
    if (extra_stream == NULL || bz_error != BZ_OK)
        goto cleanup;

    output_fd = open(patch_file, O_CREAT | O_EXCL | O_WRONLY, 0666);
    if (output_fd < 0)
        goto cleanup;
    output_created = 1;
    output_file = fdopen(output_fd, "wb");
    if (output_file == NULL)
        goto cleanup;
    output_fd = -1;
    encode_offset(target_size, target_size_buffer);
    if (fwrite("ENDSLEY/BSDIFF43", 16, 1, output_file) != 1 ||
        fwrite(target_size_buffer, sizeof(target_size_buffer), 1, output_file) != 1)
        goto cleanup;
    output_stream = BZ2_bzWriteOpen(&bz_error, output_file, 9, 0, 0);
    if (output_stream == NULL || bz_error != BZ_OK)
        goto cleanup;

    while (target_position < target_size) {
        int64_t control[3];
        int index;
        int64_t next_old_position;
        if (read_exact(
                control_stream,
                control_buffer,
                sizeof(control_buffer)) != 0)
            goto cleanup;
        for (index = 0; index < 3; index++)
            control[index] = decode_offset(control_buffer + index * 8);
        if (control[0] < 0 || control[1] < 0 ||
            control[0] > target_size - target_position ||
            checked_add(target_position, control[0], &target_position) != 0 ||
            control[1] > target_size - target_position ||
            checked_add(target_position, control[1], &target_position) != 0 ||
            checked_add(old_position, control[0], &next_old_position) != 0 ||
            checked_add(next_old_position, control[2], &old_position) != 0)
            goto cleanup;
        if (write_exact(
                output_stream,
                control_buffer,
                sizeof(control_buffer)) != 0 ||
            copy_bytes(diff_stream, output_stream, control[0]) != 0 ||
            copy_bytes(extra_stream, output_stream, control[1]) != 0)
            goto cleanup;
    }

    BZ2_bzWriteClose(&bz_error, output_stream, 0, NULL, NULL);
    output_stream = NULL;
    if (bz_error != BZ_OK || fflush(output_file) != 0 ||
        fsync(fileno(output_file)) != 0 || fclose(output_file) != 0)
        goto cleanup;
    output_file = NULL;
    result = 0;

cleanup:
    if (output_stream != NULL)
        BZ2_bzWriteClose(&bz_error, output_stream, 1, NULL, NULL);
    if (control_stream != NULL)
        BZ2_bzReadClose(&bz_error, control_stream);
    if (diff_stream != NULL)
        BZ2_bzReadClose(&bz_error, diff_stream);
    if (extra_stream != NULL)
        BZ2_bzReadClose(&bz_error, extra_stream);
    if (header_file != NULL)
        fclose(header_file);
    if (control_file != NULL)
        fclose(control_file);
    if (diff_file != NULL)
        fclose(diff_file);
    if (extra_file != NULL)
        fclose(extra_file);
    if (output_file != NULL)
        fclose(output_file);
    if (output_fd >= 0)
        close(output_fd);
    if (result != 0 && output_created)
        unlink(patch_file);
    return result;
}
