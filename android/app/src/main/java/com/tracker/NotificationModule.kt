package com.tracker

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONArray

/**
 * R8b: bridge to [NotificationScheduler]. JS passes the full planned set as
 * JSON; native cancels the old alarms and arms the new ones (inexact).
 */
class NotificationModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  init {
    NotificationScheduler.ensureChannels(reactContext)
  }

  override fun getName(): String = "TrackerNotifications"

  @ReactMethod
  fun scheduleAll(itemsJson: String, promise: Promise) {
    try {
      promise.resolve(NotificationScheduler.scheduleAll(reactApplicationContext, JSONArray(itemsJson)))
    } catch (e: Exception) {
      promise.reject("schedule_failed", "could not schedule")
    }
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    NotificationScheduler.cancelAll(reactApplicationContext)
    promise.resolve(true)
  }
}
