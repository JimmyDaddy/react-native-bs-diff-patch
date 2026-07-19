package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = BsDiffPatchNative.NAME)
class BsDiffPatchModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private val support = BsDiffPatchModuleSupport(reactContext)

  override fun getName(): String = BsDiffPatchNative.NAME

  @ReactMethod
  fun patch(oldFile: String, newFile: String, patchFile: String, promise: Promise) =
    support.patch(oldFile, newFile, patchFile, promise)

  @ReactMethod
  fun diff(oldFile: String, newFile: String, patchFile: String, promise: Promise) =
    support.diff(oldFile, newFile, patchFile, promise)

  @ReactMethod
  fun startPatch(
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

  @ReactMethod
  fun startDiff(
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

  @ReactMethod
  fun cancel(jobId: String, promise: Promise) = support.cancel(jobId, promise)

  @ReactMethod
  fun addListener(eventName: String) = support.addListener(eventName)

  @ReactMethod
  fun removeListeners(count: Double) = support.removeListeners(count)

  override fun invalidate() {
    support.invalidate()
    super.invalidate()
  }
}
