package com.tracker

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * R9b: app lock. A UI gate only: no keys, no crypto, nothing stored, nothing logged.
 * Allowed authenticators: any biometric (weak or strong) OR the device PIN / pattern /
 * password, so the screen-lock credential is the built-in fallback (and no negative
 * button is set, which the library forbids when DEVICE_CREDENTIAL is allowed).
 * BIOMETRIC_WEAK | DEVICE_CREDENTIAL is valid on every API level >= minSdk.
 */
class BiometricModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private val authenticators =
    BiometricManager.Authenticators.BIOMETRIC_WEAK or
      BiometricManager.Authenticators.DEVICE_CREDENTIAL

  override fun getName(): String = "TrackerBiometric"

  /** 'available' | 'none_enrolled' | 'no_hardware' | 'unavailable' */
  @ReactMethod
  fun canUseAppLock(promise: Promise) {
    val result =
      when (BiometricManager.from(reactApplicationContext).canAuthenticate(authenticators)) {
        BiometricManager.BIOMETRIC_SUCCESS -> "available"
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "none_enrolled"
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "no_hardware"
        else -> "unavailable"
      }
    promise.resolve(result)
  }

  /** Resolves true on success. Rejects with 'cancelled' | 'lockout' | 'no_activity' | 'error'. */
  @ReactMethod
  fun authenticate(title: String, subtitle: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity as? FragmentActivity
    if (activity == null) {
      promise.reject("no_activity", "no activity")
      return
    }
    activity.runOnUiThread {
      val callback =
        object : BiometricPrompt.AuthenticationCallback() {
          override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
            promise.resolve(true)
          }

          override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
            val code =
              when (errorCode) {
                BiometricPrompt.ERROR_USER_CANCELED,
                BiometricPrompt.ERROR_CANCELED,
                BiometricPrompt.ERROR_NEGATIVE_BUTTON -> "cancelled"
                BiometricPrompt.ERROR_LOCKOUT,
                BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "lockout"
                else -> "error"
              }
            promise.reject(code, code)
          }
        }
      try {
        val prompt =
          BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback)
        val info =
          BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(authenticators)
            .build()
        prompt.authenticate(info)
      } catch (e: Exception) {
        promise.reject("error", "error")
      }
    }
  }
}
