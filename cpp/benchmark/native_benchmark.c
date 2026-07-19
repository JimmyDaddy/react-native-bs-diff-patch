#ifdef __APPLE__
#define _DARWIN_C_SOURCE
#else
#define _POSIX_C_SOURCE 200809L
#endif

#include "bsdiff.h"
#include "bspatch.h"

#include <errno.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define CHUNK_SIZE (64 * 1024)

static double elapsed_ms(const struct timespec *start, const struct timespec *end)
{
    return ((double)(end->tv_sec - start->tv_sec) * 1000.0) +
        ((double)(end->tv_nsec - start->tv_nsec) / 1000000.0);
}

static int write_fixture(const char *path, uint64_t size, int modified)
{
    FILE *file = fopen(path, "wb");
    uint8_t *buffer = malloc(CHUNK_SIZE);
    uint64_t offset = 0;

    if (file == NULL || buffer == NULL)
        goto failure;

    while (offset < size) {
        size_t chunk = (size - offset) < CHUNK_SIZE ? (size_t)(size - offset) : CHUNK_SIZE;
        size_t index;

        for (index = 0; index < chunk; index++) {
            uint64_t absolute = offset + index;
            uint8_t value = (uint8_t)((absolute * 31 + (absolute >> 8)) & 0xff);
            if (modified && absolute % 4096 == 0)
                value ^= 0x5a;
            buffer[index] = value;
        }
        if (fwrite(buffer, 1, chunk, file) != chunk)
            goto failure;
        offset += chunk;
    }

    free(buffer);
    return fclose(file) == 0 ? 0 : -1;

failure:
    free(buffer);
    if (file != NULL)
        fclose(file);
    return -1;
}

static int files_equal(const char *left_path, const char *right_path)
{
    FILE *left = fopen(left_path, "rb");
    FILE *right = fopen(right_path, "rb");
    uint8_t left_buffer[CHUNK_SIZE];
    uint8_t right_buffer[CHUNK_SIZE];
    int equal = 0;

    if (left == NULL || right == NULL)
        goto cleanup;

    for (;;) {
        size_t left_count = fread(left_buffer, 1, sizeof(left_buffer), left);
        size_t right_count = fread(right_buffer, 1, sizeof(right_buffer), right);
        if (left_count != right_count || memcmp(left_buffer, right_buffer, left_count) != 0)
            goto cleanup;
        if (left_count == 0) {
            equal = feof(left) && feof(right);
            break;
        }
    }

cleanup:
    if (left != NULL)
        fclose(left);
    if (right != NULL)
        fclose(right);
    return equal;
}

static long peak_rss_kib(void)
{
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) != 0)
        return -1;
#ifdef __APPLE__
    return usage.ru_maxrss / 1024;
#else
    return usage.ru_maxrss;
#endif
}

int main(int argc, char **argv)
{
    char temporary_template[] = "/tmp/bsdiffpatch-benchmark-XXXXXX";
    char old_path[512];
    char new_path[512];
    char patch_path[512];
    char restored_path[512];
    char *temporary_directory;
    char *end = NULL;
    long size_mib;
    uint64_t size;
    struct timespec diff_start;
    struct timespec diff_end;
    struct timespec patch_start;
    struct timespec patch_end;
    struct stat patch_stat;
    int status = EXIT_FAILURE;

    if (argc != 2) {
        fprintf(stderr, "Usage: %s <size-mib>\n", argv[0]);
        return EXIT_FAILURE;
    }

    errno = 0;
    size_mib = strtol(argv[1], &end, 10);
    if (errno != 0 || end == argv[1] || *end != '\0' || size_mib <= 0 || size_mib > 512) {
        fprintf(stderr, "size-mib must be an integer from 1 to 512\n");
        return EXIT_FAILURE;
    }
    size = (uint64_t)size_mib * 1024 * 1024;

    temporary_directory = mkdtemp(temporary_template);
    if (temporary_directory == NULL)
        return EXIT_FAILURE;
    snprintf(old_path, sizeof(old_path), "%s/old.bin", temporary_directory);
    snprintf(new_path, sizeof(new_path), "%s/new.bin", temporary_directory);
    snprintf(patch_path, sizeof(patch_path), "%s/change.patch", temporary_directory);
    snprintf(restored_path, sizeof(restored_path), "%s/restored.bin", temporary_directory);

    if (write_fixture(old_path, size, 0) != 0 || write_fixture(new_path, size, 1) != 0)
        goto cleanup;

    clock_gettime(CLOCK_MONOTONIC, &diff_start);
    if (bsDiffFile(old_path, new_path, patch_path) != 0)
        goto cleanup;
    clock_gettime(CLOCK_MONOTONIC, &diff_end);

    clock_gettime(CLOCK_MONOTONIC, &patch_start);
    if (bsPatchFile(old_path, restored_path, patch_path) != 0)
        goto cleanup;
    clock_gettime(CLOCK_MONOTONIC, &patch_end);

    if (!files_equal(new_path, restored_path) || stat(patch_path, &patch_stat) != 0)
        goto cleanup;

    printf(
        "{\"sizeMiB\":%ld,\"diffMs\":%.1f,\"patchMs\":%.1f,\"patchBytes\":%" PRIdMAX ",\"peakRssKiB\":%ld}\n",
        size_mib,
        elapsed_ms(&diff_start, &diff_end),
        elapsed_ms(&patch_start, &patch_end),
        (intmax_t)patch_stat.st_size,
        peak_rss_kib());
    status = EXIT_SUCCESS;

cleanup:
    unlink(restored_path);
    unlink(patch_path);
    unlink(new_path);
    unlink(old_path);
    rmdir(temporary_directory);
    return status;
}
