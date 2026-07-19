package com.jimmydaddy.bsdiffpatch

import java.io.File

internal object BsDiffPatchNative {
  const val NAME = "BsDiffPatch"

  init {
    System.loadLibrary("react-native-bs-diff-patch")
  }

  fun patch(oldFile: String, newFile: String, patchFile: String): Int {
    validateNonEmpty(oldFile, "oldFile")
    validateNonEmpty(newFile, "newFile")
    validateNonEmpty(patchFile, "patchFile")
    validateDistinct(oldFile, newFile, patchFile)

    val oldFileObj = File(normalizePath(oldFile))
    val newFileObj = File(normalizePath(newFile))
    val patchFileObj = File(normalizePath(patchFile))

    if (!oldFileObj.exists()) {
      throw BsDiffPatchException("ENOENT", "oldFile: $oldFile does not exist")
    }
    if (!patchFileObj.exists()) {
      throw BsDiffPatchException("ENOENT", "patchFile: $patchFile does not exist")
    }
    if (newFileObj.exists()) {
      throw BsDiffPatchException("EEXIST", "newFile: $newFile already exists")
    }

    return requireSuccess(
      "EPATCH",
      "patch",
      bsPatchFile(
        oldFileObj.absolutePath,
        newFileObj.absolutePath,
        patchFileObj.absolutePath
      )
    )
  }

  fun diff(oldFile: String, newFile: String, patchFile: String): Int {
    validateNonEmpty(oldFile, "oldFile")
    validateNonEmpty(newFile, "newFile")
    validateNonEmpty(patchFile, "patchFile")
    validateDistinct(oldFile, newFile, patchFile)

    val oldFileObj = File(normalizePath(oldFile))
    val newFileObj = File(normalizePath(newFile))
    val patchFileObj = File(normalizePath(patchFile))

    if (!oldFileObj.exists()) {
      throw BsDiffPatchException("ENOENT", "oldFile: $oldFile does not exist")
    }
    if (!newFileObj.exists()) {
      throw BsDiffPatchException("ENOENT", "newFile: $newFile does not exist")
    }
    if (patchFileObj.exists()) {
      throw BsDiffPatchException("EEXIST", "patchFile: $patchFile already exists")
    }

    return requireSuccess(
      "EDIFF",
      "diff",
      bsDiffFile(
        oldFileObj.absolutePath,
        newFileObj.absolutePath,
        patchFileObj.absolutePath
      )
    )
  }

  private fun requireSuccess(code: String, operation: String, result: Int): Int {
    if (result != 0) {
      throw BsDiffPatchException(code, "$operation failed with native result $result")
    }
    return result
  }

  private fun validateNonEmpty(value: String, fieldName: String) {
    if (value.isEmpty()) {
      throw BsDiffPatchException("EINVAL", "$fieldName can not be null or empty")
    }
  }

  private fun validateDistinct(oldFile: String, newFile: String, patchFile: String) {
    if (oldFile == newFile || oldFile == patchFile || newFile == patchFile) {
      throw BsDiffPatchException(
        "EINVAL",
        "oldFile, newFile, patchFile can not be the same"
      )
    }
  }

  private fun normalizePath(path: String): String {
    return if (path.startsWith("file://")) path.substring(7) else path
  }

  @JvmStatic
  private external fun bsPatchFile(oldFile: String, newFile: String, patchFile: String): Int

  @JvmStatic
  private external fun bsDiffFile(oldFile: String, newFile: String, patchFile: String): Int
}

internal class BsDiffPatchException(
  val code: String,
  override val message: String
) : IllegalArgumentException(message)
