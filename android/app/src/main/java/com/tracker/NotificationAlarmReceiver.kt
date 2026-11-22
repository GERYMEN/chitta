package com.tracker

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * R8b: fires when an inexact alarm goes off and POSTS the text JS pre-built
 * (read back from SharedPreferences). Not exported. Tapping the notification
 * just opens the app (which may then show the app lock). Without the
 * POST_NOTIFICATIONS grant the system silently drops the post.
 */
class NotificationAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra(NotificationScheduler.EXTRA_ID) ?: return
    val item = NotificationScheduler.find(context, id) ?: return
    NotificationScheduler.ensureChannels(context)
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val tap = PendingIntent.getActivity(
      context,
      id.hashCode(),
      open,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, item.getString("channel"))
      else Notification.Builder(context)
    val notification = builder
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(item.getString("title"))
      .setContentText(item.getString("body"))
      .setContentIntent(tap)
      .setAutoCancel(true)
      .build()
    context.getSystemService(NotificationManager::class.java)?.notify(id.hashCode(), notification)
    NotificationScheduler.forget(context, id)
  }
}
