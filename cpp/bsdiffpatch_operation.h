#ifndef BSDIFFPATCH_OPERATION_H
#define BSDIFFPATCH_OPERATION_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bs_operation_result {
    BS_OPERATION_OK = 0,
    BS_OPERATION_ERROR = -1,
    BS_OPERATION_INPUT_TOO_LARGE = -2,
    BS_OPERATION_OUTPUT_TOO_LARGE = -3,
    BS_OPERATION_CANCELLED = -4,
    BS_OPERATION_DESTINATION_EXISTS = -5
};

enum bs_operation_phase {
    BS_OPERATION_READING = 0,
    BS_OPERATION_PROCESSING = 1,
    BS_OPERATION_WRITING = 2
};

struct bs_operation_options {
    int64_t max_input_bytes;
    int64_t max_output_bytes;
    void *opaque;
    int (*is_cancelled)(void *opaque);
    void (*progress)(void *opaque, int phase, double progress);
};

int bsDiffFileWithOptions(
    const char *old_file,
    const char *new_file,
    const char *patch_file,
    const struct bs_operation_options *options);

int bsPatchFileWithOptions(
    const char *old_file,
    const char *new_file,
    const char *patch_file,
    const struct bs_operation_options *options);

#ifdef __cplusplus
}
#endif

#endif
