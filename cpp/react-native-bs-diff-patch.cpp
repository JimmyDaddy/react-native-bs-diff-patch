
extern "C" {
  #include "bsdiff.h"
  #include "bspatch.h"
}

#include "react-native-bs-diff-patch.h"

namespace bsdiffpatch {

  int diffFile(const char* oldFile, const char* newFile, const char* patchFile) {
    return bsDiffFile(oldFile, newFile, patchFile);
  }

  int patchFile(const char* oldFile, const char* newFile, const char* patchFile) {
    return bsPatchFile(oldFile, newFile, patchFile);
  }

  int diffFileWithOptions(
      const char* oldFile,
      const char* newFile,
      const char* patchFile,
      const bs_operation_options* options) {
    return bsDiffFileWithOptions(oldFile, newFile, patchFile, options);
  }

  int patchFileWithOptions(
      const char* oldFile,
      const char* newFile,
      const char* patchFile,
      const bs_operation_options* options) {
    return bsPatchFileWithOptions(oldFile, newFile, patchFile, options);
  }
}
