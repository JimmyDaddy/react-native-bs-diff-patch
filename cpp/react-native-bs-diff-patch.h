#ifndef BSDIFFPATCH_H
#define BSDIFFPATCH_H

#include "bsdiffpatch_operation.h"

namespace bsdiffpatch {
  int diffFile(const char* oldFile, const char* newFile, const char* patchFile);
  int patchFile(const char* oldFile, const char* newFile, const char* patchFile);
  int diffFileWithOptions(
      const char* oldFile,
      const char* newFile,
      const char* patchFile,
      const bs_operation_options* options);
  int patchFileWithOptions(
      const char* oldFile,
      const char* newFile,
      const char* patchFile,
      const bs_operation_options* options);
  const char* diffLastErrorStage();
}

#endif /* BSDIFFPATCH_H */
