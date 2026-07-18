package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

internal class BsDiffPatchTaskRunner {
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "BsDiffPatchWorker")
  }

  fun execute(promise: Promise, block: () -> Int) {
    try {
      executor.execute {
        try {
          promise.resolve(block())
        } catch (error: BsDiffPatchException) {
          promise.reject(error.code, error.message, error)
        } catch (error: Exception) {
          promise.reject("EUNSPECIFIED", error.message, error)
        }
      }
    } catch (error: RejectedExecutionException) {
      promise.reject("EUNAVAILABLE", "BsDiffPatch module is no longer available", error)
    }
  }

  fun shutdown() {
    executor.shutdown()
  }
}
