package com.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** R8b: alarms do not survive a reboot, so re-arm the stored items (RECEIVE_BOOT_COMPLETED). */
class NotificationBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
      NotificationScheduler.rescheduleFromStore(context)
    }
  }
}
