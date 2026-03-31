package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = BsDiffPatchNative.NAME)
class BsDiffPatchModule(reactContext: ReactApplicationContext) :
  NativeBsDiffPatchSpec(reactContext) {
  override fun getName(): String = BsDiffPatchNative.NAME

  override fun patch(
    oldFile: String,
    newFile: String,
    patchFile: String,
    promise: Promise
  ) {
    execute(promise) {
      BsDiffPatchNative.patch(oldFile, newFile, patchFile)
    }
  }

  override fun diff(
    oldFile: String,
    newFile: String,
    patchFile: String,
    promise: Promise
  ) {
    execute(promise) {
      BsDiffPatchNative.diff(oldFile, newFile, patchFile)
    }
  }

  private fun execute(promise: Promise, block: () -> Int) {
    try {
      promise.resolve(block())
    } catch (error: BsDiffPatchException) {
      promise.reject(error.code, error.message, error)
    } catch (error: Exception) {
      promise.reject("EUNSPECIFIED", error.message, error)
    }
  }
}
