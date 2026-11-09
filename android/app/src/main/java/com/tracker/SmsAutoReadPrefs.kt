package com.tracker

import android.content.Context

/**
 * R5: the receiver's own on/off flag (one boolean in SharedPreferences). JS
 * mirrors the effective "Read new SMS automatically" state here on every app
 * start and toggle. Default false: after an update nothing is read until the
 * app has run and decided. Holds no SMS data.
 */
object SmsAutoReadPrefs {
  private const val FILE = "tracker_auto_read"
  private const val KEY_ENABLED = "enabled"

  fun isEnabled(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

  fun setEnabled(context: Context, enabled: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
  }
}
