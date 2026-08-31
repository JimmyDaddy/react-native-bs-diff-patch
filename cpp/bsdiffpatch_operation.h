#ifndef BSDIFFPATCH_OPERATION_H
#define BSDIFFPATCH_OPERATION_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

enum bs_operation_result {
    BS_OPERATION_OK = 0,
    BS_OPERATION_ERROR = -1,
    BS_OPERATION_INPUT_TOO_LARGE = -2,
    BS_OPERATION_OUTPUT_TOO_LARGE = -3,
    BS_OPERATION_CANCELLED = -4,
    BS_OPERATION_DESTINATION_EXISTS = -5,
    BS_OPERATION_INVALID_ARGUMENT = -6
};

enum bs_operation_phase {
    BS_OPERATION_READING = 0,
    BS_OPERATION_PROCESSING = 1,
    BS_OPERATION_WRITING = 2
};

/*
 * A positive limit historically enabled the corresponding guard.  The flags
 * preserve that behaviour for zero-initialized callers rebuilt with this
 * header while allowing the Web bridge to express a deliberate zero-byte
 * budget (where zero must not mean "unlimited").
 */
enum bs_operation_limit_flags {
    BS_OPERATION_LIMIT_INPUT = 1 << 0,
    BS_OPERATION_LIMIT_OUTPUT = 1 << 1
};

struct bs_operation_options {
    int64_t max_input_bytes;
    int64_t max_output_bytes;
    void *opaque;
    int (*is_cancelled)(void *opaque);
    void (*progress)(void *opaque, int phase, double progress);
    unsigned int limit_flags;
};

static inline int bs_operation_has_input_limit(
    const struct bs_operation_options *options)
{
    return options != NULL && (options->max_input_bytes > 0 ||
        (options->limit_flags & BS_OPERATION_LIMIT_INPUT) != 0);
}

static inline int bs_operation_has_output_limit(
    const struct bs_operation_options *options)
{
    return options != NULL && (options->max_output_bytes > 0 ||
        (options->limit_flags & BS_OPERATION_LIMIT_OUTPUT) != 0);
}

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

int bsPatchFileStreamingWithOptions(
    const char *old_file,
    const char *new_file,
    const char *patch_file,
    const struct bs_operation_options *options);

#ifdef __cplusplus
}
#endif

#endif
