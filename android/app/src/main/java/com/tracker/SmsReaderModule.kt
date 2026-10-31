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
 * Legacy-style native module reading the existing SMS inbox via
 * ContentResolver (R4b: date-bounded pages + a count; no 200-message cap). No TurboModule codegen spec is needed:
 * RN's interop layer handles a plain ReactContextBaseJavaModule even with the
 * New Architecture enabled.
 */
class SmsReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "SmsReader"

  private fun hasReadSms(): Boolean =
    ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.READ_SMS) ==
      PackageManager.PERMISSION_GRANTED

  /**
   * R4b: one page of the inbox, newest first, inside a date window.
   *
   *   selection: date >= ? AND (date < ? OR (date = ? AND _id < ?))
   *   order:     date DESC, _id DESC
   *
   * Every value is a BOUND selection argument (never concatenated). The
   * caller pages by passing the (date, _id) of the oldest row it has seen as
   * (beforeMs, beforeId); SMS sharing one date are split by `_id`, so none is
   * skipped or read twice. First page: beforeId = 0 (`_id < 0` never
   * matches), i.e. exactly `sinceMs <= date < beforeMs`. At most `limit`
   * rows are read from the cursor (no LIMIT clause in the sort order, which
   * some SMS providers reject). Bodies are handed to JS for in-memory
   * parsing only — never logged or stored here.
   */
  @ReactMethod
  fun readInboxPage(sinceMs: Double, beforeMs: Double, beforeId: Double, limit: Double, promise: Promise) {
    if (!hasReadSms()) {
      promise.reject("E_SMS_PERMISSION_DENIED", "android.permission.READ_SMS has not been granted")
      return
    }

    val items: WritableArray = Arguments.createArray()
    val before = beforeMs.toLong().toString()
    val args = arrayOf(sinceMs.toLong().toString(), before, before, beforeId.toLong().toString())

    try {
      reactApplicationContext.contentResolver.query(
        Uri.parse("content://sms/inbox"),
        arrayOf("_id", "address", "body", "date"),
        "date >= ? AND (date < ? OR (date = ? AND _id < ?))",
        args,
        "date DESC, _id DESC",
      )?.use { cursor ->
        val idIndex = cursor.getColumnIndexOrThrow("_id")
        val addressIndex = cursor.getColumnIndexOrThrow("address")
        val bodyIndex = cursor.getColumnIndexOrThrow("body")
        val dateIndex = cursor.getColumnIndexOrThrow("date")

        var count = 0
        val max = limit.toInt().coerceAtLeast(0)

        while (count < max && cursor.moveToNext()) {
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
      promise.reject("E_SMS_READ_FAILED", "Failed to read the SMS inbox", e)
    }
  }

  /**
   * R4b: number of inbox SMS with date >= sinceMs (bound argument), for the
   * "About N SMS to scan" estimate. Reads no address/body: COUNT(*) first;
   * providers that reject an aggregate projection fall back to counting an
   * `_id`-only cursor.
   */
  @ReactMethod
  fun countInboxSince(sinceMs: Double, promise: Promise) {
    if (!hasReadSms()) {
      promise.reject("E_SMS_PERMISSION_DENIED", "android.permission.READ_SMS has not been granted")
      return
    }

    val uri = Uri.parse("content://sms/inbox")
    val selection = "date >= ?"
    val args = arrayOf(sinceMs.toLong().toString())

    try {
      val counted: Int? = try {
        reactApplicationContext.contentResolver.query(
          uri,
          arrayOf("COUNT(*)"),
          selection,
          args,
          null,
        )?.use { cursor -> if (cursor.moveToFirst()) cursor.getInt(0) else 0 }
      } catch (e: Exception) {
        null
      }

      val total = counted ?: (
        reactApplicationContext.contentResolver.query(
          uri,
          arrayOf("_id"),
          selection,
          args,
          null,
        )?.use { cursor -> cursor.count } ?: 0
      )
      promise.resolve(total.toDouble())
    } catch (e: Exception) {
      promise.reject("E_SMS_READ_FAILED", "Failed to count the SMS inbox", e)
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

    if (!hasReadSms()) {
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
