package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule

abstract class NativeBsDiffPatchSpec(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  abstract fun patch(
    oldFile: String,
    newFile: String,
    patchFile: String,
    promise: Promise
  )

  abstract fun diff(
    oldFile: String,
    newFile: String,
    patchFile: String,
    promise: Promise
  )

  abstract fun startPatch(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  )

  abstract fun startDiff(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  )

  abstract fun cancel(jobId: String, promise: Promise)

  abstract fun addListener(eventName: String)

  abstract fun removeListeners(count: Double)
}
