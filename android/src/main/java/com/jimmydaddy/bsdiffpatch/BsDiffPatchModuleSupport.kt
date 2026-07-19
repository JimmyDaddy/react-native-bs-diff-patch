package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.atomic.AtomicInteger

internal class BsDiffPatchModuleSupport(
  private val reactContext: ReactApplicationContext
) {
  private val listenerCount = AtomicInteger(0)
  private val taskRunner = BsDiffPatchTaskRunner()

  init {
    BsDiffPatchNative.setProgressListener(::emitProgress)
  }

  fun patch(oldFile: String, newFile: String, patchFile: String, promise: Promise) {
    taskRunner.execute(promise) {
      BsDiffPatchNative.patch(oldFile, newFile, patchFile)
    }
  }

  fun diff(oldFile: String, newFile: String, patchFile: String, promise: Promise) {
    taskRunner.execute(promise) {
      BsDiffPatchNative.diff(oldFile, newFile, patchFile)
    }
  }

  fun startPatch(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  ) {
    taskRunner.executeJob(jobId, promise) {
      BsDiffPatchNative.patchJob(
        jobId,
        oldFile,
        newFile,
        patchFile,
        maxInputBytes,
        maxOutputBytes
      )
    }
  }

  fun startDiff(
    jobId: String,
    oldFile: String,
    newFile: String,
    patchFile: String,
    maxInputBytes: Double,
    maxOutputBytes: Double,
    promise: Promise
  ) {
    taskRunner.executeJob(jobId, promise) {
      BsDiffPatchNative.diffJob(
        jobId,
        oldFile,
        newFile,
        patchFile,
        maxInputBytes,
        maxOutputBytes
      )
    }
  }

  fun cancel(jobId: String, promise: Promise) {
    try {
      val cancelled = taskRunner.cancel(jobId)
      val nativeCancelled = BsDiffPatchNative.cancel(jobId)
      promise.resolve(cancelled || nativeCancelled)
    } catch (error: BsDiffPatchException) {
      promise.reject(error.code, error.message, error)
    }
  }

  fun addListener(eventName: String) {
    if (eventName == BsDiffPatchNative.PROGRESS_EVENT) {
      listenerCount.incrementAndGet()
    }
  }

  fun removeListeners(count: Double) {
    val requested = count.toInt().coerceAtLeast(0)
    listenerCount.updateAndGet { current -> (current - requested).coerceAtLeast(0) }
  }

  fun invalidate() {
    BsDiffPatchNative.setProgressListener(null)
    taskRunner.shutdown().forEach(BsDiffPatchNative::cancel)
  }

  private fun emitProgress(jobId: String, phase: Int, progress: Double) {
    if (listenerCount.get() <= 0) return
    val event = Arguments.createMap().apply {
      putString("id", jobId)
      putString(
        "phase",
        when (phase) {
          0 -> "reading"
          1 -> "processing"
          else -> "writing"
        }
      )
      putDouble("progress", progress.coerceIn(0.0, 1.0))
    }
    reactContext
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit(BsDiffPatchNative.PROGRESS_EVENT, event)
  }
}
