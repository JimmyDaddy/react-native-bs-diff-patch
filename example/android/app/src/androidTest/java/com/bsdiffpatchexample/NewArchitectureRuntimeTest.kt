package com.bsdiffpatchexample

import android.os.SystemClock
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.NoMatchingViewException
import androidx.test.espresso.assertion.ViewAssertions.matches
import androidx.test.espresso.matcher.ViewMatchers.isDisplayed
import androidx.test.espresso.matcher.ViewMatchers.withText
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
@LargeTest
class NewArchitectureRuntimeTest {
  @get:Rule
  val activityRule = ActivityScenarioRule(MainActivity::class.java)

  @Test
  fun diffAndPatchRoundTripThroughTurboModule() {
    assertTrue(
      "The runtime assertion must execute with React Native New Architecture enabled",
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
    )

    val deadline = SystemClock.uptimeMillis() + RUNTIME_TIMEOUT_MS
    var lastFailure: Throwable? = null

    while (SystemClock.uptimeMillis() < deadline) {
      try {
        onView(withText("Runtime: success")).check(matches(isDisplayed()))
        onView(withText("Controls: success")).check(matches(isDisplayed()))
        return
      } catch (error: NoMatchingViewException) {
        lastFailure = error
      } catch (error: AssertionError) {
        lastFailure = error
      }

      SystemClock.sleep(RETRY_INTERVAL_MS)
    }

    throw AssertionError(
      "The React Native round trip and native operation controls did not complete successfully",
      lastFailure
    )
  }

  private companion object {
    const val RUNTIME_TIMEOUT_MS = 30_000L
    const val RETRY_INTERVAL_MS = 250L
  }
}
