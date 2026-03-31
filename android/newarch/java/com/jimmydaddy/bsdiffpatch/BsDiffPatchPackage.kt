package com.jimmydaddy.bsdiffpatch

import com.facebook.react.TurboReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class BsDiffPatchPackage : TurboReactPackage() {
  override fun getModule(
    name: String,
    reactContext: ReactApplicationContext
  ): NativeModule? {
    return if (name == BsDiffPatchNative.NAME) {
      BsDiffPatchModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        BsDiffPatchNative.NAME to ReactModuleInfo(
          BsDiffPatchNative.NAME,
          BsDiffPatchModule::class.java.name,
          false,
          false,
          false,
          false,
          true
        )
      )
    }
  }
}
