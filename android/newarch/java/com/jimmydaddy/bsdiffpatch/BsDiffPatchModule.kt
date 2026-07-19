package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = BsDiffPatchNative.NAME)
class BsDiffPatchModule(reactContext: ReactApplicationContext) :
  NativeBsDiffPatchSpec(reactContext) {
  private val support = BsDiffPatchModuleSupport(reactContext)

  override fun getName(): String = BsDiffPatchNative.NAME

  override fun patch(oldFile: String, newFile: String, patchFile: String, promise: Promise) =
    support.patch(oldFile, newFile, patchFile, promise)

  override fun diff(oldFile: String, newFile: String, patchFile: String, promise: Promise) =
    support.diff(oldFile, newFile, patchFile, promise)

  override fun startPatch(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  ) = support.startPatch(
    jobId,
    oldFile,
    newFile,
    patchFile,
    maxInputBytes,
    maxOutputBytes,
    promise
  )

  override fun startDiff(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  ) = support.startDiff(
    jobId,
    oldFile,
    newFile,
    patchFile,
    maxInputBytes,
    maxOutputBytes,
    promise
  )

  override fun cancel(jobId: String, promise: Promise) = support.cancel(jobId, promise)

  override fun addListener(eventName: String) = support.addListener(eventName)

  override fun removeListeners(count: Double) = support.removeListeners(count)

  override fun invalidate() {
    support.invalidate()
    super.invalidate()
  }
}
