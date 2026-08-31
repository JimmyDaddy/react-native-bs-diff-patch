#ifndef BSDIFF40_CONVERTER_H
#define BSDIFF40_CONVERTER_H

#ifdef __cplusplus
extern "C" {
#endif

int bsConvertBsdiff40File(
    const char *legacy_patch_file,
    const char *patch_file);

#ifdef __cplusplus
}
#endif

#endif
