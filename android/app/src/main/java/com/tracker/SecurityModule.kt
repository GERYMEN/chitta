package com.tracker

import android.view.WindowManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * R9a: FLAG_SECURE toggle. [setSecureScreen] stores the preference (read by
 * MainActivity at create) and applies the flag to the live window. No
 * permission. Hidden in recents + screenshots/screen-recording blocked while on.
 */
class SecurityModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "TrackerSecurity"

  @ReactMethod
  fun setSecureScreen(enabled: Boolean, promise: Promise) {
    SecurityPrefs.setSecure(reactApplicationContext, enabled)
    val activity = reactApplicationContext.currentActivity
    if (activity != null) {
      activity.runOnUiThread {
        if (enabled) activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        else activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
      }
    }
    promise.resolve(true)
  }
}
