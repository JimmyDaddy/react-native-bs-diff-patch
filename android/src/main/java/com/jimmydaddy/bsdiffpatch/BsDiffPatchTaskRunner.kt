package com.jimmydaddy.bsdiffpatch

import com.facebook.react.bridge.Promise
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean

internal class BsDiffPatchTaskRunner {
  private data class Job(val cancelled: AtomicBoolean = AtomicBoolean(false))

  private val jobs = ConcurrentHashMap<String, Job>()
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "BsDiffPatchWorker")
  }

  fun execute(promise: Promise, block: () -> Any?) {
    submit(promise) { block() }
  }

  fun executeJob(jobId: String, promise: Promise, block: () -> Int) {
    val job = Job()
    if (jobs.putIfAbsent(jobId, job) != null) {
      promise.reject("EEXIST", "jobId: $jobId already exists")
      return
    }
    val submitted = submit(promise) {
      try {
        if (job.cancelled.get()) {
          throw BsDiffPatchException("ECANCELLED", "operation was cancelled")
        }
        block()
      } finally {
        jobs.remove(jobId, job)
      }
    }
    if (!submitted) {
      jobs.remove(jobId, job)
    }
  }

  fun cancel(jobId: String): Boolean {
    val job = jobs[jobId] ?: return false
    job.cancelled.set(true)
    return true
  }

  fun shutdown(): List<String> {
    val activeJobIds = jobs.keys.toList()
    jobs.values.forEach { it.cancelled.set(true) }
    executor.shutdown()
    return activeJobIds
  }

  private fun submit(promise: Promise, block: () -> Any?): Boolean {
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
      return true
    } catch (error: RejectedExecutionException) {
      promise.reject("EUNAVAILABLE", "BsDiffPatch module is no longer available", error)
      return false
    }
  }
}
