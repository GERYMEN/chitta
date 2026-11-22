package com.tracker

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * R8b: all notification scheduling in one place. JS builds the items (id, title,
 * body, whenEpochMs, channel); this object stores them in SharedPreferences and
 * sets one INEXACT alarm per item. [NotificationAlarmReceiver] posts the stored
 * text at fire time; [NotificationBootReceiver] calls [rescheduleFromStore]
 * after a reboot. No exact alarms, no SCHEDULE_EXACT_ALARM, no JS at fire time.
 */
object NotificationScheduler {
  private const val FILE = "tracker_notifications"
  private const val KEY_ITEMS = "items"
  const val ACTION_FIRE = "com.tracker.NOTIFICATION_FIRE"
  const val EXTRA_ID = "id"
  /** An alarm missed by more than this (phone off) is dropped, not posted late. */
  private const val MAX_LATE_MS = 2L * 24 * 60 * 60 * 1000

  private val CHANNELS = listOf(
    Triple("bills", "Bills", "Bill due and overdue reminders"),
    Triple("reminders", "Recurring payments", "Reminders you asked for on repeating payments"),
    Triple("summary", "Weekly summary", "A short weekly summary"),
  )

  fun ensureChannels(context: Context) {
    // Channels exist from Android 8 (API 26); minSdk is 24.
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    for ((id, name, description) in CHANNELS) {
      val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_DEFAULT)
      channel.description = description
      manager.createNotificationChannel(channel)
    }
  }

  private fun prefs(context: Context) = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun loadItems(context: Context): JSONArray =
    try {
      JSONArray(prefs(context).getString(KEY_ITEMS, "[]"))
    } catch (e: Exception) {
      JSONArray()
    }

  private fun saveItems(context: Context, items: JSONArray) {
    prefs(context).edit().putString(KEY_ITEMS, items.toString()).apply()
  }

  private fun pendingIntent(context: Context, id: String): PendingIntent {
    val intent = Intent(context, NotificationAlarmReceiver::class.java)
      .setAction(ACTION_FIRE)
      .setData(Uri.parse("tracker://notification/" + Uri.encode(id)))
      .putExtra(EXTRA_ID, id)
    return PendingIntent.getBroadcast(
      context,
      id.hashCode(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  /** Cancel every app-owned alarm and forget the stored items. */
  fun cancelAll(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    val items = loadItems(context)
    for (i in 0 until items.length()) {
      alarms?.cancel(pendingIntent(context, items.getJSONObject(i).getString("id")))
    }
    saveItems(context, JSONArray())
  }

  /** Reconcile: cancel everything we own, then schedule exactly [items]. Returns how many. */
  fun scheduleAll(context: Context, items: JSONArray): Int {
    cancelAll(context)
    ensureChannels(context)
    saveItems(context, items)
    return arm(context, items)
  }

  fun rescheduleFromStore(context: Context): Int {
    ensureChannels(context)
    val now = System.currentTimeMillis()
    val keep = JSONArray()
    val stored = loadItems(context)
    for (i in 0 until stored.length()) {
      val item = stored.getJSONObject(i)
      if (item.getLong("whenEpochMs") >= now - MAX_LATE_MS) keep.put(item)
    }
    saveItems(context, keep)
    return arm(context, keep)
  }

  private fun arm(context: Context, items: JSONArray): Int {
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return 0
    for (i in 0 until items.length()) {
      val item = items.getJSONObject(i)
      // INEXACT on purpose: the system may shift it a little; no exact-alarm permission needed.
      alarms.setAndAllowWhileIdle(
        AlarmManager.RTC_WAKEUP,
        item.getLong("whenEpochMs"),
        pendingIntent(context, item.getString("id")),
      )
    }
    return items.length()
  }

  fun find(context: Context, id: String): JSONObject? {
    val items = loadItems(context)
    for (i in 0 until items.length()) {
      val item = items.getJSONObject(i)
      if (item.getString("id") == id) return item
    }
    return null
  }

  /** Remove one fired item from the stored set (so a reboot does not re-post it). */
  fun forget(context: Context, id: String) {
    val items = loadItems(context)
    val keep = JSONArray()
    for (i in 0 until items.length()) {
      val item = items.getJSONObject(i)
      if (item.getString("id") != id) keep.put(item)
    }
    saveItems(context, keep)
  }
}
