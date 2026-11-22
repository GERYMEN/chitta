package com.tracker

import android.content.Context

/**
 * R9a: native mirror of the `secure_screen` setting (one boolean in
 * SharedPreferences) so MainActivity can set FLAG_SECURE at create time,
 * before JS runs. JS (app_settings) is the source of truth and re-mirrors it
 * on every launch and toggle. Default false. Holds no user data.
 */
object SecurityPrefs {
  private const val FILE = "tracker_security"
  private const val KEY_SECURE = "secure_screen"

  fun isSecure(context: Context): Boolean =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(KEY_SECURE, false)

  fun setSecure(context: Context, secure: Boolean) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(KEY_SECURE, secure).apply()
  }
}
