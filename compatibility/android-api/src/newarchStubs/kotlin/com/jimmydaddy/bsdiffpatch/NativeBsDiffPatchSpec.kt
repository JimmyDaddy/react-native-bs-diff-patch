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
}
