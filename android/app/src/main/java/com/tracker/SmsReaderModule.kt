package com.tracker

import android.Manifest
import android.content.pm.PackageManager
import android.net.Uri
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * Legacy-style native module exposing a synchronous bridge method to read the
 * existing SMS inbox via ContentResolver. No TurboModule codegen spec is needed:
 * RN's interop layer handles a plain ReactContextBaseJavaModule even with the
 * New Architecture enabled.
 */
class SmsReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SmsReader"

  @ReactMethod
  fun readInbox(limit: Double, promise: Promise) {
    val context = reactApplicationContext

    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "E_SMS_PERMISSION_DENIED",
        "android.permission.READ_SMS has not been granted",
      )
      return
    }

    val items: WritableArray = Arguments.createArray()

    try {
      context.contentResolver.query(
        Uri.parse("content://sms/inbox"),
        arrayOf("_id", "address", "body", "date"),
        null,
        null,
        "date DESC",
      )?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow("_id")
        val addressIndex = cursor.getColumnIndexOrThrow("address")
        val bodyIndex = cursor.getColumnIndexOrThrow("body")
        val dateIndex = cursor.getColumnIndexOrThrow("date")

        var count = 0
        val max = limit.toInt().coerceAtLeast(0)

        while (cursor.moveToNext() && count < max) {
          val map: WritableMap = Arguments.createMap()
          map.putString("id", cursor.getLong(idIndex).toString())
          map.putString("address", cursor.getString(addressIndex) ?: "")
          map.putString("body", cursor.getString(bodyIndex) ?: "")
          map.putDouble("date", cursor.getLong(dateIndex).toDouble())
          items.pushMap(map)
          count++
        }
      }

      promise.resolve(items)
    } catch (e: Exception) {
      promise.reject("E_SMS_READ_FAILED", e.message ?: "Failed to read the SMS inbox", e)
    }
  }

  /**
   * Reads a single SMS (any box) by its `_id`. Resolves `{id, address, body,
   * date}` or `null` when no such message exists. The id is passed only as a
   * bound selection argument, never concatenated into the selection string.
   */
  @ReactMethod
  fun readById(id: String, promise: Promise) {
    val context = reactApplicationContext

    if (
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      promise.reject(
        "E_SMS_PERMISSION_DENIED",
        "android.permission.READ_SMS has not been granted",
      )
      return
    }

    try {
      var result: WritableMap? = null
      context.contentResolver.query(
        Uri.parse("content://sms"),
        arrayOf("_id", "address", "body", "date"),
        "_id = ?",
        arrayOf(id),
        null,
      )?.use { cursor ->
        if (cursor.moveToFirst()) {
          val map: WritableMap = Arguments.createMap()
          map.putString("id", cursor.getLong(cursor.getColumnIndexOrThrow("_id")).toString())
          map.putString("address", cursor.getString(cursor.getColumnIndexOrThrow("address")) ?: "")
          map.putString("body", cursor.getString(cursor.getColumnIndexOrThrow("body")) ?: "")
          map.putDouble("date", cursor.getLong(cursor.getColumnIndexOrThrow("date")).toDouble())
          result = map
        }
      }
      promise.resolve(result)
    } catch (e: Exception) {
      promise.reject("E_SMS_READ_FAILED", "Failed to read the SMS message", e)
    }
  }
}
