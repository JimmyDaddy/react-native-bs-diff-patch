package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = BsDiffPatchNative.NAME)
class BsDiffPatchModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private val taskRunner = BsDiffPatchTaskRunner()

  override fun getName(): String = BsDiffPatchNative.NAME

  @ReactMethod
  fun patch(oldFile: String?, newFile: String?, patchFile: String?, promise: Promise) {
    execute(promise) {
      BsDiffPatchNative.patch(
        requireArgument(oldFile, "oldFile"),
        requireArgument(newFile, "newFile"),
        requireArgument(patchFile, "patchFile")
      )
    }
  }

  @ReactMethod
  fun diff(oldFile: String?, newFile: String?, patchFile: String?, promise: Promise) {
    execute(promise) {
      BsDiffPatchNative.diff(
        requireArgument(oldFile, "oldFile"),
        requireArgument(newFile, "newFile"),
        requireArgument(patchFile, "patchFile")
      )
    }
  }

  private fun requireArgument(value: String?, fieldName: String): String {
    if (value.isNullOrEmpty()) {
      throw BsDiffPatchException("EINVAL", "$fieldName can not be null or empty")
    }
    return value
  }

  private fun execute(promise: Promise, block: () -> Int) {
    taskRunner.execute(promise, block)
  }

  override fun invalidate() {
    taskRunner.shutdown()
    super.invalidate()
  }
}
