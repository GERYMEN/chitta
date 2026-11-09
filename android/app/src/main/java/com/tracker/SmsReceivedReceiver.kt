package com.tracker

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * R5 auto-read: manifest-registered receiver for SMS_RECEIVED (exported, but
 * only the system can send it — android:permission="android.permission.BROADCAST_SMS").
 *
 * Privacy: it never reads the intent extras (no PDUs, no body, no sender),
 * never logs, never stores anything. It only starts SmsAutoReadService, which
 * runs the app's normal incremental inbox sync a few seconds later.
 *
 * Background start: an app receiving SMS_RECEIVED is put on the temporary
 * power allowlist (Android 8+ background-execution exemption for SMS/MMS
 * broadcasts), so startService() from here is allowed. If a device still
 * refuses, nothing is lost: the next sync (auto or manual) reads the same
 * window (cursor + 1-day overlap + dedup).
 */
class SmsReceivedReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    if (!SmsAutoReadPrefs.isEnabled(context)) return
    try {
      context.startService(Intent(context, SmsAutoReadService::class.java))
    } catch (e: IllegalStateException) {
      // Background start refused on this device — the next sync catches up.
    } catch (e: SecurityException) {
      // Same: never crash the receiver.
    }
  }
}
