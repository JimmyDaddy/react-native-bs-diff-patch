package com.jimmydaddy.bsdiffpatch

import java.io.File
import java.io.FileInputStream
import java.io.RandomAccessFile
import org.json.JSONObject
import kotlin.math.floor

internal object BsDiffPatchNative {
  const val NAME = "BsDiffPatch"
  const val PROGRESS_EVENT = "BsDiffPatchProgress"
  private const val JS_MAX_SAFE_INTEGER = 9_007_199_254_740_991.0

  @Volatile
  private var progressListener: ((String, Int, Double) -> Unit)? = null

  init {
    System.loadLibrary("react-native-bs-diff-patch")
  }

  fun patch(oldFile: String, newFile: String, patchFile: String): Int {
    val paths = validatePatchPaths(oldFile, newFile, patchFile)
    return requireSuccess(
      "EPATCH",
      "patch",
      bsPatchFile(paths.old.absolutePath, paths.output.absolutePath, paths.input.absolutePath)
    )
  }

  fun diff(oldFile: String, newFile: String, patchFile: String): Int {
    val paths = validateDiffPaths(oldFile, newFile, patchFile)
    return requireSuccess(
      "EDIFF",
      "diff",
      bsDiffFile(paths.old.absolutePath, paths.input.absolutePath, paths.output.absolutePath)
    )
  }

  fun inspectPatch(patchFile: String, maxInputBytes: Double): String {
    val inputLimit = validateLimit(maxInputBytes, "maxInputBytes")
    val patch = File(normalizePath(patchFile))
    validateNonEmpty(patchFile, "patchFile")
    requireInput(patch, "patchFile", patchFile)
    enforceInputLimit(inputLimit, patch)
    return inspectPatchFile(patch).toJson().toString()
  }

  fun verifyPatch(
    oldFile: String,
    patchFile: String,
    expectedFile: String,
    outputFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double
  ): String {
    validateNonEmpty(oldFile, "oldFile")
    validateNonEmpty(patchFile, "patchFile")
    validateNonEmpty(expectedFile, "expectedFile")
    validateNonEmpty(outputFile, "outputFile")
    val normalized = listOf(oldFile, patchFile, expectedFile, outputFile).map(::normalizePath)
    if (normalized.toSet().size != normalized.size) {
      throw BsDiffPatchException(
        "EINVAL",
        "oldFile, patchFile, expectedFile, and internal output can not be the same"
      )
    }

    val old = File(normalized[0])
    val patch = File(normalized[1])
    val expected = File(normalized[2])
    val output = File(normalized[3])
    requireInput(old, "oldFile", oldFile)
    requireInput(patch, "patchFile", patchFile)
    requireInput(expected, "expectedFile", expectedFile)
    requireOutput(output, "outputFile", outputFile)

    val inputLimit = validateLimit(maxInputBytes, "maxInputBytes")
    val outputLimit = validateLimit(maxOutputBytes, "maxOutputBytes")
    enforceInputLimit(inputLimit, old, patch, expected)
    enforcePatchOutputLimit(outputLimit, patch)
    val metadata = inspectPatchFile(patch)
    if (!metadata.valid) {
      throw BsDiffPatchException(
        "EPATCH",
        "patch structure is invalid: ${metadata.issue ?: "UNKNOWN"}"
      )
    }

    requireSuccess(
      "EPATCH",
      "patch verification",
      bsPatchFile(old.absolutePath, output.absolutePath, patch.absolutePath)
    )
    if (outputLimit > 0 && output.length() > outputLimit) {
      throw BsDiffPatchException(
        "EOUTPUT_TOO_LARGE",
        "output is ${output.length()} bytes and exceeds the configured $outputLimit byte limit"
      )
    }
    val verified = filesEqual(output, expected)
    return JSONObject()
      .put("verified", verified)
      .put("restoredBytes", output.length())
      .put("expectedBytes", expected.length())
      .put("patch", metadata.toJson())
      .toString()
  }

  fun patchJob(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double
  ): Int {
    validateJobId(jobId)
    val inputLimit = validateLimit(maxInputBytes, "maxInputBytes")
    val outputLimit = validateLimit(maxOutputBytes, "maxOutputBytes")
    val paths = validatePatchPaths(oldFile, newFile, patchFile)
    enforceInputLimit(inputLimit, paths.old, paths.input)
    enforcePatchOutputLimit(outputLimit, paths.input)
    return requireJobSuccess(
      "EPATCH",
      "patch",
      inputLimit,
      outputLimit,
      bsPatchFileWithOptions(
        jobId,
        paths.old.absolutePath,
        paths.output.absolutePath,
        paths.input.absolutePath,
        inputLimit,
        outputLimit
      )
    )
  }

  fun diffJob(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double
  ): Int {
    validateJobId(jobId)
    val inputLimit = validateLimit(maxInputBytes, "maxInputBytes")
    val outputLimit = validateLimit(maxOutputBytes, "maxOutputBytes")
    val paths = validateDiffPaths(oldFile, newFile, patchFile)
    enforceInputLimit(inputLimit, paths.old, paths.input)
    return requireJobSuccess(
      "EDIFF",
      "diff",
      inputLimit,
      outputLimit,
      bsDiffFileWithOptions(
        jobId,
        paths.old.absolutePath,
        paths.input.absolutePath,
        paths.output.absolutePath,
        inputLimit,
        outputLimit
      )
    )
  }

  fun cancel(jobId: String): Boolean {
    validateJobId(jobId)
    return bsCancelOperation(jobId)
  }

  fun setProgressListener(listener: ((String, Int, Double) -> Unit)?) {
    progressListener = listener
  }

  @JvmStatic
  private fun onNativeProgress(jobId: String, phase: Int, progress: Double) {
    progressListener?.invoke(jobId, phase, progress)
  }

  private fun validatePatchPaths(oldFile: String, newFile: String, patchFile: String): Paths {
    validatePaths(oldFile, newFile, patchFile)
    val old = File(normalizePath(oldFile))
    val output = File(normalizePath(newFile))
    val input = File(normalizePath(patchFile))
    requireInput(old, "oldFile", oldFile)
    requireInput(input, "patchFile", patchFile)
    requireOutput(output, "newFile", newFile)
    return Paths(old, input, output)
  }

  private fun validateDiffPaths(oldFile: String, newFile: String, patchFile: String): Paths {
    validatePaths(oldFile, newFile, patchFile)
    val old = File(normalizePath(oldFile))
    val input = File(normalizePath(newFile))
    val output = File(normalizePath(patchFile))
    requireInput(old, "oldFile", oldFile)
    requireInput(input, "newFile", newFile)
    requireOutput(output, "patchFile", patchFile)
    return Paths(old, input, output)
  }

  private fun validatePaths(oldFile: String, newFile: String, patchFile: String) {
    validateNonEmpty(oldFile, "oldFile")
    validateNonEmpty(newFile, "newFile")
    validateNonEmpty(patchFile, "patchFile")
    if (oldFile == newFile || oldFile == patchFile || newFile == patchFile) {
      throw BsDiffPatchException(
        "EINVAL",
        "oldFile, newFile, patchFile can not be the same"
      )
    }
  }

  private fun validateJobId(jobId: String) {
    validateNonEmpty(jobId, "jobId")
  }

  private fun validateLimit(value: Double, fieldName: String): Long {
    if (value == 0.0) return 0
    if (!value.isFinite() || value < 1 || value > JS_MAX_SAFE_INTEGER || floor(value) != value) {
      throw BsDiffPatchException(
        "EINVAL",
        "$fieldName must be a positive safe integer"
      )
    }
    return value.toLong()
  }

  private fun enforceInputLimit(limit: Long, vararg files: File) {
    if (limit == 0L) return
    files.forEach { file ->
      val observed = file.length()
      if (observed > limit) {
        throw BsDiffPatchException(
          "EINPUT_TOO_LARGE",
          "input is $observed bytes and exceeds the configured $limit byte limit"
        )
      }
    }
  }

  private fun enforcePatchOutputLimit(limit: Long, patchFile: File) {
    if (limit == 0L || patchFile.length() < 24) return
    RandomAccessFile(patchFile, "r").use { file ->
      file.seek(16)
      var size = 0L
      repeat(8) { index ->
        val byte = file.readUnsignedByte()
        if (index == 7 && byte and 0x80 != 0) return
        val magnitudeByte = if (index == 7) byte and 0x7f else byte
        size = size or (magnitudeByte.toLong() shl (index * 8))
      }
      if (size > limit) {
        throw BsDiffPatchException(
          "EOUTPUT_TOO_LARGE",
          "output is $size bytes and exceeds the configured $limit byte limit"
        )
      }
    }
  }

  private fun inspectPatchFile(patchFile: File): PatchMetadataValue {
    val patchBytes = patchFile.length()
    val headerBytes = minOf(patchBytes, 24L).toInt()
    val header = ByteArray(headerBytes)
    FileInputStream(patchFile).use { input ->
      var offset = 0
      while (offset < header.size) {
        val count = input.read(header, offset, header.size - offset)
        if (count < 0) break
        offset += count
      }
    }
    val legacyMagic = header.copyOfRange(0, minOf(8, header.size)).toString(Charsets.US_ASCII)
    val currentMagic = header.copyOfRange(0, minOf(16, header.size)).toString(Charsets.US_ASCII)
    if (header.size < 24) {
      return PatchMetadataValue(
        format = if (legacyMagic == "BSDIFF40") "BSDIFF40" else "UNKNOWN",
        patchBytes = patchBytes,
        headerBytes = header.size,
        declaredTargetBytes = null,
        valid = false,
        issue = if (legacyMagic == "BSDIFF40") "LEGACY_FORMAT" else "TRUNCATED_HEADER"
      )
    }
    if (currentMagic != "ENDSLEY/BSDIFF43") {
      return PatchMetadataValue(
        format = if (legacyMagic == "BSDIFF40") "BSDIFF40" else "UNKNOWN",
        patchBytes = patchBytes,
        headerBytes = 24,
        declaredTargetBytes = null,
        valid = false,
        issue = if (legacyMagic == "BSDIFF40") "LEGACY_FORMAT" else "INVALID_MAGIC"
      )
    }
    if (header[23].toInt() and 0x80 != 0) {
      return PatchMetadataValue(
        format = "ENDSLEY/BSDIFF43",
        patchBytes = patchBytes,
        headerBytes = 24,
        declaredTargetBytes = null,
        valid = false,
        issue = "INVALID_TARGET_SIZE"
      )
    }
    var targetBytes = 0L
    for (index in 23 downTo 16) {
      targetBytes = targetBytes * 256 + (header[index].toInt() and 0xff)
    }
    return PatchMetadataValue(
      format = "ENDSLEY/BSDIFF43",
      patchBytes = patchBytes,
      headerBytes = 24,
      declaredTargetBytes = targetBytes.toString(),
      valid = true,
      issue = null
    )
  }

  private fun filesEqual(first: File, second: File): Boolean {
    if (first.length() != second.length()) return false
    FileInputStream(first).buffered().use { firstInput ->
      FileInputStream(second).buffered().use { secondInput ->
        val firstBuffer = ByteArray(DEFAULT_BUFFER_SIZE)
        val secondBuffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
          val firstCount = firstInput.read(firstBuffer)
          val secondCount = secondInput.read(secondBuffer)
          if (firstCount != secondCount) return false
          if (firstCount < 0) return true
          for (index in 0 until firstCount) {
            if (firstBuffer[index] != secondBuffer[index]) return false
          }
        }
      }
    }
  }

  private fun requireInput(file: File, fieldName: String, originalPath: String) {
    if (!file.exists()) {
      throw BsDiffPatchException("ENOENT", "$fieldName: $originalPath does not exist")
    }
  }

  private fun requireOutput(file: File, fieldName: String, originalPath: String) {
    if (file.exists()) {
      throw BsDiffPatchException("EEXIST", "$fieldName: $originalPath already exists")
    }
  }

  private fun requireSuccess(code: String, operation: String, result: Int): Int {
    if (result != 0) {
      throw BsDiffPatchException(code, "$operation failed with native result $result")
    }
    return result
  }

  private fun requireJobSuccess(
    fallbackCode: String,
    operation: String,
    inputLimit: Long,
    outputLimit: Long,
    result: Int
  ): Int {
    if (result == 0) return result
    val code = when (result) {
      -2 -> "EINPUT_TOO_LARGE"
      -3 -> "EOUTPUT_TOO_LARGE"
      -4 -> "ECANCELLED"
      -5 -> "EEXIST"
      else -> fallbackCode
    }
    val detail = when (result) {
      -2 -> "configured input limit: $inputLimit bytes"
      -3 -> "configured output limit: $outputLimit bytes"
      -4 -> "operation was cancelled"
      -5 -> "destination or job already exists"
      else -> "native result $result"
    }
    throw BsDiffPatchException(code, "$operation failed: $detail")
  }

  private fun validateNonEmpty(value: String, fieldName: String) {
    if (value.isEmpty()) {
      throw BsDiffPatchException("EINVAL", "$fieldName can not be null or empty")
    }
  }

  private fun normalizePath(path: String): String {
    return if (path.startsWith("file://")) path.substring(7) else path
  }

  @JvmStatic
  private external fun bsPatchFile(oldFile: String, newFile: String, patchFile: String): Int

  @JvmStatic
  private external fun bsDiffFile(oldFile: String, newFile: String, patchFile: String): Int

  @JvmStatic
  private external fun bsPatchFileWithOptions(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Long,
    maxOutputBytes: Long
  ): Int

  @JvmStatic
  private external fun bsDiffFileWithOptions(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Long,
    maxOutputBytes: Long
  ): Int

  @JvmStatic
  private external fun bsCancelOperation(jobId: String): Boolean

  private data class Paths(val old: File, val input: File, val output: File)

  private data class PatchMetadataValue(
    val format: String,
    val patchBytes: Long,
    val headerBytes: Int,
    val declaredTargetBytes: String?,
    val valid: Boolean,
    val issue: String?
  ) {
    fun toJson(): JSONObject = JSONObject()
      .put("format", format)
      .put("patchBytes", patchBytes)
      .put("headerBytes", headerBytes)
      .put("payloadBytes", (patchBytes - 24L).coerceAtLeast(0L))
      .put("declaredTargetBytes", declaredTargetBytes ?: JSONObject.NULL)
      .put("valid", valid)
      .apply {
        if (issue != null) put("issue", issue)
      }
  }
}

internal class BsDiffPatchException(
  val code: String,
  override val message: String
) : IllegalArgumentException(message)
