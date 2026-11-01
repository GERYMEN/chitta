package com.tracker

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.PixelCopy
import androidx.core.content.FileProvider
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream

/**
 * R4c: feedback screenshot + WhatsApp share. Own code, no library.
 *
 * Privacy:
 * - The PNG is written ONLY to the app cache (cache/feedback/). Old
 *   screenshots are deleted before every capture and on app start
 *   (clearScreenshots), and by Remove (deleteScreenshot).
 * - Nothing here logs, uploads or copies the image. It leaves the app only
 *   through the user's own share action, as a read-only content:// grant.
 * - The JS side switches the app into REDACTED mode and hides the feedback
 *   button BEFORE calling captureScreen.
 */
class FeedbackModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "TrackerFeedback"

  /** Device info only: app version, Android release, brand + model. */
  override fun getConstants(): MutableMap<String, Any> {
    val context = reactApplicationContext
    var versionName = ""
    var versionCode = 0.0
    try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      versionName = info.versionName ?: ""
      versionCode =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode.toDouble()
        else @Suppress("DEPRECATION") info.versionCode.toDouble()
    } catch (e: Exception) {
      // Leave the defaults; the badge then reads "v (0)".
    }
    return mutableMapOf(
      "versionName" to versionName,
      "versionCode" to versionCode,
      "androidRelease" to (Build.VERSION.RELEASE ?: ""),
      "brand" to (Build.BRAND ?: ""),
      "model" to (Build.MODEL ?: ""),
    )
  }

  private fun feedbackDir(): File = File(reactApplicationContext.cacheDir, DIR_NAME)

  private fun clearDir() {
    feedbackDir().listFiles()?.forEach { it.delete() }
  }

  /** A path the JS side passed back: must be a file directly inside cache/feedback/. */
  private fun ownScreenshot(path: String?): File? {
    if (path.isNullOrEmpty()) return null
    val dir = feedbackDir().canonicalFile
    val file = File(path).canonicalFile
    return if (file.parentFile == dir && file.isFile) file else null
  }

  /**
   * Capture the current Activity window to cache/feedback/feedback-<ms>.png.
   * PixelCopy on API 26+, else draws the decor view. Resolves
   * {uri, path, width, height, bytes}.
   */
  @ReactMethod
  fun captureScreen(promise: Promise) {
    val activity: Activity? = reactApplicationContext.currentActivity
    if (activity == null || activity.isFinishing) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity to capture")
      return
    }
    activity.runOnUiThread {
      try {
        val window = activity.window
        val decor = window.decorView
        val width = decor.width
        val height = decor.height
        if (width <= 0 || height <= 0) {
          promise.reject("E_CAPTURE_FAILED", "The window has no size yet")
          return@runOnUiThread
        }
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          PixelCopy.request(
            window,
            bitmap,
            { result ->
              if (result == PixelCopy.SUCCESS) {
                writePng(bitmap, promise)
              } else {
                bitmap.recycle()
                promise.reject("E_CAPTURE_FAILED", "PixelCopy failed")
              }
            },
            Handler(Looper.getMainLooper()),
          )
        } else {
          decor.draw(Canvas(bitmap))
          writePng(bitmap, promise)
        }
      } catch (e: Exception) {
        promise.reject("E_CAPTURE_FAILED", "Could not capture the screen")
      }
    }
  }

  private fun writePng(bitmap: Bitmap, promise: Promise) {
    Thread {
      try {
        clearDir()
        val dir = feedbackDir()
        if (!dir.exists()) dir.mkdirs()
        val file = File(dir, "feedback-${System.currentTimeMillis()}.png")
        FileOutputStream(file).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        val map = Arguments.createMap()
        map.putString("uri", "file://${file.absolutePath}")
        map.putString("path", file.absolutePath)
        map.putInt("width", bitmap.width)
        map.putInt("height", bitmap.height)
        map.putDouble("bytes", file.length().toDouble())
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("E_CAPTURE_FAILED", "Could not save the screenshot")
      } finally {
        bitmap.recycle()
      }
    }.start()
  }

  /** Delete every feedback screenshot (app start). */
  @ReactMethod
  fun clearScreenshots(promise: Promise) {
    try {
      clearDir()
      promise.resolve(true)
    } catch (e: Exception) {
      promise.resolve(false)
    }
  }

  /** Remove one screenshot (sheet "Remove"). Only files inside cache/feedback/. */
  @ReactMethod
  fun deleteScreenshot(path: String, promise: Promise) {
    val file = ownScreenshot(path)
    promise.resolve(file?.delete() ?: false)
  }

  private fun buildSendIntent(text: String, path: String?): Intent? {
    val intent = Intent(Intent.ACTION_SEND)
    intent.putExtra(Intent.EXTRA_TEXT, text)
    if (path.isNullOrEmpty()) {
      intent.type = "text/plain"
      return intent
    }
    val file = ownScreenshot(path) ?: return null
    val context = reactApplicationContext
    val uri = FileProvider.getUriForFile(context, "${context.packageName}$AUTHORITY_SUFFIX", file)
    intent.type = "image/png"
    intent.putExtra(Intent.EXTRA_STREAM, uri)
    intent.clipData = ClipData.newRawUri("", uri)
    intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return intent
  }

  /**
   * ACTION_SEND straight to one WhatsApp package with the contact jid.
   * Resolves "sent", or "not_installed" when that package cannot take it
   * (ActivityNotFoundException — no <queries> / package visibility needed).
   */
  @ReactMethod
  fun shareToPackage(packageName: String, jid: String, text: String, path: String?, promise: Promise) {
    if (packageName !in ALLOWED_PACKAGES) {
      promise.reject("E_BAD_PACKAGE", "Unsupported share target")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    val intent = buildSendIntent(text, path)
    if (intent == null) {
      promise.reject("E_NO_SCREENSHOT", "The screenshot is no longer available")
      return
    }
    intent.setPackage(packageName)
    intent.putExtra("jid", jid)
    try {
      activity.startActivity(intent)
      promise.resolve("sent")
    } catch (e: ActivityNotFoundException) {
      promise.resolve("not_installed")
    } catch (e: Exception) {
      promise.reject("E_SHARE_FAILED", "Could not open the share target")
    }
  }

  /** Last resort with a screenshot: the system share chooser. */
  @ReactMethod
  fun shareChooser(text: String, path: String?, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    val intent = buildSendIntent(text, path)
    if (intent == null) {
      promise.reject("E_NO_SCREENSHOT", "The screenshot is no longer available")
      return
    }
    try {
      val chooser = Intent.createChooser(intent, "Send feedback")
      chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      activity.startActivity(chooser)
      promise.resolve("sent")
    } catch (e: Exception) {
      promise.reject("E_SHARE_FAILED", "Could not open the share chooser")
    }
  }

  companion object {
    private const val DIR_NAME = "feedback"
    private const val AUTHORITY_SUFFIX = ".feedbackprovider"
    private val ALLOWED_PACKAGES = setOf("com.whatsapp", "com.whatsapp.w4b")
  }
}
