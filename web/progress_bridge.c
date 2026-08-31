#include "bsdiffpatch_operation.h"

#include <emscripten/emscripten.h>
#include <math.h>
#include <string.h>

#define WEB_MAX_SAFE_INTEGER 9007199254740991.0

EM_JS(void, web_report_progress, (int phase, double progress), {
  if (typeof Module.onProgress === 'function') {
    Module.onProgress(phase, progress);
  }
});

static void report_progress(void *opaque, int phase, double progress)
{
    (void)opaque;
    web_report_progress(phase, progress);
}

static void configure_options(struct bs_operation_options *options)
{
    memset(options, 0, sizeof(*options));
    options->progress = report_progress;
}

static int configure_limits(
    struct bs_operation_options *options,
    double max_input_bytes,
    double max_output_bytes)
{
    configure_options(options);
    if (!isfinite(max_input_bytes) || !isfinite(max_output_bytes) ||
        (max_input_bytes != -1 &&
            (max_input_bytes < 0 || floor(max_input_bytes) != max_input_bytes ||
                max_input_bytes > WEB_MAX_SAFE_INTEGER)) ||
        (max_output_bytes != -1 &&
            (max_output_bytes < 0 || floor(max_output_bytes) != max_output_bytes ||
                max_output_bytes > WEB_MAX_SAFE_INTEGER)))
        return BS_OPERATION_INVALID_ARGUMENT;
    if (max_input_bytes >= 0) {
        options->max_input_bytes = (int64_t)max_input_bytes;
        options->limit_flags |= BS_OPERATION_LIMIT_INPUT;
    }
    if (max_output_bytes >= 0) {
        options->max_output_bytes = (int64_t)max_output_bytes;
        options->limit_flags |= BS_OPERATION_LIMIT_OUTPUT;
    }
    return BS_OPERATION_OK;
}

int bsDiffFileWithProgress(
    const char *old_file,
    const char *new_file,
    const char *patch_file)
{
    struct bs_operation_options options;
    configure_options(&options);
    return bsDiffFileWithOptions(old_file, new_file, patch_file, &options);
}

int bsPatchFileWithProgress(
    const char *old_file,
    const char *new_file,
    const char *patch_file)
{
    struct bs_operation_options options;
    configure_options(&options);
    return bsPatchFileWithOptions(old_file, new_file, patch_file, &options);
}

int bsDiffFileWithProgressAndLimits(
    const char *old_file,
    const char *new_file,
    const char *patch_file,
    double max_input_bytes,
    double max_output_bytes)
{
    struct bs_operation_options options;
    int result = configure_limits(&options, max_input_bytes, max_output_bytes);
    if (result != BS_OPERATION_OK)
        return result;
    return bsDiffFileWithOptions(old_file, new_file, patch_file, &options);
}

int bsPatchFileWithProgressAndLimits(
    const char *old_file,
    const char *new_file,
    const char *patch_file,
    double max_input_bytes,
    double max_output_bytes)
{
    struct bs_operation_options options;
    int result = configure_limits(&options, max_input_bytes, max_output_bytes);
    if (result != BS_OPERATION_OK)
        return result;
    return bsPatchFileWithOptions(old_file, new_file, patch_file, &options);
}
