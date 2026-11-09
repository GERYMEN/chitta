package com.tracker

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** R5: lets JS mirror the effective auto-read state into the receiver flag. */
class SmsAutoReadModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SmsAutoRead"

  @ReactMethod
  fun setEnabled(enabled: Boolean, promise: Promise) {
    SmsAutoReadPrefs.setEnabled(reactApplicationContext, enabled)
    promise.resolve(enabled)
  }
}
