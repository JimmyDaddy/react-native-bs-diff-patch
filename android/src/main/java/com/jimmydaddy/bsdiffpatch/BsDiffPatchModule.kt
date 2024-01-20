package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import com.jimmydaddy.bsdiffpatch.BsDiffPatchModule
import java.io.File

@ReactModule(name = BsDiffPatchModule.NAME)
class BsDiffPatchModule(reactContext: ReactApplicationContext?) :
  ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String {
    return NAME
  }

  private fun getFileDir(dir: String): String {
    if (dir.startsWith("file://")) {
      return dir.substring(7)
    }
    return dir
  }

  // Example method
  // See https://reactnative.dev/docs/native-modules-android
  @ReactMethod
  fun patch(oldFile: String?, newFile: String?, patchFile: String?, promise: Promise) {
    if (oldFile == null || newFile == null || patchFile == null || oldFile.isEmpty() || newFile.isEmpty() || patchFile.isEmpty()) {
      promise.reject("error", "oldFile, newFile, patchFile can not be null or empty")
      return
    }
    if (oldFile == newFile || oldFile == patchFile || newFile == patchFile) {
      promise.reject("error", "oldFile, newFile, patchFile can not be the same")
      return
    }
    val oldFileObj = File(getFileDir(oldFile))
    if (!oldFileObj.exists()) {
      promise.reject("error", "oldFile: $oldFile not exist")
      return
    }
    val patchFileObj = File(getFileDir(patchFile))
    if (!patchFileObj.exists()) {
      promise.reject("error", "patchFile: $patchFile not exist")
      return
    }
    val newFileObj = File(getFileDir(newFile))
    if (newFileObj.exists()) {
      promise.reject("error", "newFile: $newFile already exist")
      return
    }
    try {
      val result = bsPatchFile(oldFileObj.absolutePath, newFileObj.absolutePath, patchFileObj.absolutePath)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("error", e.message)
    }
  }

  @ReactMethod
  fun diff(oldFile: String?, newFile: String?, patchFile: String?, promise: Promise) {
    if (oldFile == null || newFile == null || patchFile == null || oldFile.isEmpty() || newFile.isEmpty() || patchFile.isEmpty()) {
      promise.reject("error", "oldFile, newFile, patchFile can not be null or empty")
      return
    }
    if (oldFile == newFile || oldFile == patchFile || newFile == patchFile) {
      promise.reject("error", "oldFile, newFile, patchFile can not be the same")
      return
    }
    val oldFileObj = File(getFileDir(oldFile))
    if (!oldFileObj.exists()) {
      promise.reject("error", "oldFile: $oldFile not exist")
      return
    }
    val newFileObj = File(getFileDir(newFile))
    if (!newFileObj.exists()) {
      promise.reject("error", "newFile: $newFile not exist")
      return
    }
    val patchFileObj = File(getFileDir(patchFile))
    if (patchFileObj.exists()) {
      promise.reject("error", "patchFile: $patchFile already exist")
      return
    }
    try {
      val result = bsDiffFile(oldFileObj.absolutePath, newFileObj.absolutePath, patchFileObj.absolutePath)
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("error", e.message)
    }
  }

  companion object {
    const val NAME = "BsDiffPatch"

    init {
      System.loadLibrary("react-native-bs-diff-patch")
    }

    // Used to load the 'native-lib' library on application startup.
    // get new file from old file and patch file
    private external fun bsPatchFile(oldFile: String, newFile: String, patchFile: String): Int

    // generate patch file
    private external fun bsDiffFile(oldFile: String, newFile: String, patchFile: String): Int
  }
}
