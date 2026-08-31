#ifndef BSPATCH_STREAMING_H
#define BSPATCH_STREAMING_H

#include "bsdiffpatch_operation.h"

int bsPatchFileStreamingToFd(
    const char *old_file,
    const char *patch_file,
    int output_fd,
    const struct bs_operation_options *options);

#endif
