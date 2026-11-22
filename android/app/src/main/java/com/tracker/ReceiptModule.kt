package com.tracker

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * R11: receipt images through the ANDROID SYSTEM PHOTO PICKER. No runtime
 * permission and no dependency: the system picker hands back a one-time read
 * grant for exactly the image the user chose. (In-app camera capture would
 * need CAMERA and is deferred.)
 *
 *   pickReceipt(transactionId) -> picker (ACTION_PICK_IMAGES on API 33+, else
 *       ACTION_OPEN_DOCUMENT for images), copies the bytes to
 *       files/receipts/<id>-<epoch>.jpg and resolves {fileName}; resolves null
 *       when the user cancels.
 *   receiptUri(fileName)   -> content:// via [ReceiptFileProvider] if the file
 *       exists, else null (a restored backup can point at a missing file).
 *   deleteReceipt(fileName)
 *
 * Privacy: nothing here logs. The bytes live only in the app sandbox; JS keeps
 * the file NAME only. File names are validated (no path separators).
 * Reject codes: E_NO_ACTIVITY, E_BUSY, E_IO, E_TOO_LARGE, E_BAD_NAME.
 */
class ReceiptModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val io: ExecutorService = Executors.newSingleThreadExecutor()
  private var pendingPromise: Promise? = null
  private var pendingId: String = ""

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "TrackerReceipt"

  override fun invalidate() {
    pendingPromise = null
    io.shutdown()
    super.invalidate()
  }

  @ReactMethod
  fun pickReceipt(transactionId: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_BUSY", "A picker is already open")
      return
    }
    val safeId = transactionId.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(64)
    if (safeId.isEmpty()) {
      promise.reject("E_BAD_NAME", "Invalid id")
      return
    }
    val intent =
      if (Build.VERSION.SDK_INT >= 33) {
        Intent(MediaStore.ACTION_PICK_IMAGES)
      } else {
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "image/*"
        }
      }
    pendingPromise = promise
    pendingId = safeId
    try {
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: Exception) {
      pendingPromise = null
      promise.reject("E_IO", "Could not open the photo picker")
    }
  }

  @ReactMethod
  fun receiptUri(fileName: String, promise: Promise) {
    val file = receiptFile(fileName)
    if (file == null || !file.isFile) {
      promise.resolve(null)
      return
    }
    try {
      val uri =
        FileProvider.getUriForFile(
          reactApplicationContext,
          reactApplicationContext.packageName + ".receiptprovider",
          file,
        )
      promise.resolve(uri.toString())
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  @ReactMethod
  fun deleteReceipt(fileName: String, promise: Promise) {
    val file = receiptFile(fileName)
    promise.resolve(file != null && file.isFile && file.delete())
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_PICK) return
    val promise = pendingPromise ?: return
    val id = pendingId
    pendingPromise = null
    val uri: Uri? = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (uri == null) {
      promise.resolve(null)
      return
    }
    io.execute { copyPicked(uri, id, promise) }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun copyPicked(uri: Uri, id: String, promise: Promise) {
    val dir = receiptsDir()
    val name = "$id-${System.currentTimeMillis()}.jpg"
    val target = File(dir, name)
    try {
      dir.mkdirs()
      val input =
        reactApplicationContext.contentResolver.openInputStream(uri)
          ?: throw IllegalStateException("no stream")
      var total = 0L
      input.use { stream ->
        target.outputStream().use { out ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = stream.read(buffer)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) throw TooLargeException()
            out.write(buffer, 0, n)
          }
        }
      }
      val result = Arguments.createMap()
      result.putString("fileName", name)
      promise.resolve(result)
    } catch (e: TooLargeException) {
      target.delete()
      promise.reject("E_TOO_LARGE", "That image is too large")
    } catch (e: Exception) {
      target.delete()
      promise.reject("E_IO", "Could not save the receipt")
    }
  }

  private class TooLargeException : Exception()

  private fun receiptsDir(): File = File(reactApplicationContext.filesDir, "receipts")

  /** The file for a validated name, or null (blocks any path separator / traversal). */
  private fun receiptFile(fileName: String): File? {
    if (!NAME_RE.matches(fileName)) return null
    return File(receiptsDir(), fileName)
  }

  companion object {
    private const val REQUEST_PICK = 47_311
    private const val MAX_BYTES = 25L * 1024 * 1024
    private val NAME_RE = Regex("^[A-Za-z0-9_-]{1,140}\\.jpg$")
  }
}
