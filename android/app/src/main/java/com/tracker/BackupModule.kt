package com.tracker

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.util.Arrays
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * R4e: password-encrypted backup file I/O through the Storage Access
 * Framework. No permission: the user picks where the file goes (Downloads,
 * Drive, ...) and which file to restore. Crypto lives in [BackupCrypto].
 *
 * Restore is two steps so the password is asked only for a real backup:
 *   pickBackup()                 → ACTION_OPEN_DOCUMENT + header check
 *   decryptBackup(uri, password) → read + decrypt the file picked last
 *
 * Reject codes: E_CANCELLED (pick dismissed), E_NOT_BACKUP (bad magic /
 * header / size), E_TOO_NEW (newer format version), E_BAD_PASSWORD (GCM tag
 * failed: "Wrong password or damaged file"), E_BUSY, E_NO_ACTIVITY, E_IO.
 *
 * Privacy: nothing here logs. The JSON, password, key and file bytes never
 * leave this class except as the encrypted file the user chose / the JSON
 * string handed back to JS. Password char arrays are zeroed after use (the
 * JS string it came from is immutable and is dropped by the caller).
 * Crypto + file I/O run on a background executor, never on the UI thread.
 */
class BackupModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), ActivityEventListener {

  private val io: ExecutorService = Executors.newSingleThreadExecutor()

  private var pendingPromise: Promise? = null
  private var pendingRequest: Int = 0
  private var pendingJson: String? = null
  private var pendingPassword: CharArray? = null
  /** The file the user picked last — decryptBackup only accepts this one. */
  @Volatile private var pickedUri: Uri? = null

  init {
    reactContext.addActivityEventListener(this)
  }

  override fun getName(): String = "TrackerBackup"

  override fun getConstants(): MutableMap<String, Any> =
    mutableMapOf(
      "formatVersion" to BackupCrypto.FORMAT_VERSION,
      "iterations" to BackupCrypto.ITERATIONS,
    )

  override fun invalidate() {
    clearPending()
    io.shutdown()
    super.invalidate()
  }

  private fun clearPending() {
    pendingPassword?.let { Arrays.fill(it, '\u0000') }
    pendingPassword = null
    pendingJson = null
    pendingPromise = null
    pendingRequest = 0
  }

  /**
   * Ask where to save, then encrypt [json] with [password] and write it.
   * Resolves {saved: true, name, bytes} or {saved: false} when cancelled.
   */
  @ReactMethod
  fun saveBackup(json: String, password: String, suggestedName: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_BUSY", "A backup file picker is already open")
      return
    }
    val intent =
      Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = MIME_TYPE
        putExtra(Intent.EXTRA_TITLE, safeFileName(suggestedName))
      }
    pendingPromise = promise
    pendingRequest = REQUEST_SAVE
    pendingJson = json
    pendingPassword = password.toCharArray()
    try {
      activity.startActivityForResult(intent, REQUEST_SAVE)
    } catch (e: Exception) {
      clearPending()
      promise.reject("E_IO", "Could not open the file picker")
    }
  }

  /**
   * Let the user pick a backup file and check its header. Resolves
   * {uri, name, bytes}; rejects E_CANCELLED / E_NOT_BACKUP / E_TOO_NEW.
   */
  @ReactMethod
  fun pickBackup(promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "No foreground activity")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_BUSY", "A backup file picker is already open")
      return
    }
    val intent =
      Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        // .trkbak has no registered MIME type; providers label it differently.
        type = "*/*"
      }
    pendingPromise = promise
    pendingRequest = REQUEST_OPEN
    try {
      activity.startActivityForResult(intent, REQUEST_OPEN)
    } catch (e: Exception) {
      clearPending()
      promise.reject("E_IO", "Could not open the file picker")
    }
  }

  /** Decrypt the file picked by [pickBackup]; resolves the JSON string. */
  @ReactMethod
  fun decryptBackup(uri: String, password: String, promise: Promise) {
    val picked = pickedUri
    if (picked == null || picked.toString() != uri) {
      promise.reject("E_NOT_BACKUP", "Pick the backup file again")
      return
    }
    val chars = password.toCharArray()
    io.execute {
      try {
        val bytes = readAll(picked)
        val plain = BackupCrypto.decrypt(bytes, chars)
        try {
          promise.resolve(String(plain, Charsets.UTF_8))
        } finally {
          Arrays.fill(plain, 0)
        }
      } catch (e: BackupCrypto.BadPasswordException) {
        promise.reject("E_BAD_PASSWORD", "Wrong password or damaged file")
      } catch (e: BackupCrypto.TooNewException) {
        promise.reject("E_TOO_NEW", "This backup was made by a newer version of Tracker")
      } catch (e: BackupCrypto.NotBackupException) {
        promise.reject("E_NOT_BACKUP", "This file is not a Tracker backup")
      } catch (e: TooLargeException) {
        promise.reject("E_NOT_BACKUP", "This file is not a Tracker backup")
      } catch (e: Exception) {
        promise.reject("E_IO", "Could not read the backup file")
      } finally {
        Arrays.fill(chars, '\u0000')
      }
    }
  }

  /** Drop the remembered pick (restore finished or abandoned). */
  @ReactMethod
  fun forgetPickedBackup(promise: Promise) {
    pickedUri = null
    promise.resolve(true)
  }

  override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
    if (requestCode != REQUEST_SAVE && requestCode != REQUEST_OPEN) return
    val promise = pendingPromise ?: return
    if (requestCode != pendingRequest) return
    val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (requestCode == REQUEST_SAVE) {
      val json = pendingJson
      val password = pendingPassword
      // Ownership of the password array moves to the worker below.
      pendingPassword = null
      clearPending()
      if (uri == null || json == null || password == null) {
        password?.let { Arrays.fill(it, '\u0000') }
        promise.resolve(Arguments.createMap().apply { putBoolean("saved", false) })
        return
      }
      io.execute { writeBackup(uri, json, password, promise) }
    } else {
      clearPending()
      if (uri == null) {
        promise.reject("E_CANCELLED", "No file picked")
        return
      }
      io.execute { inspectPicked(uri, promise) }
    }
  }

  override fun onNewIntent(intent: Intent) = Unit

  private fun writeBackup(uri: Uri, json: String, password: CharArray, promise: Promise) {
    val resolver = reactApplicationContext.contentResolver
    try {
      val plain = json.toByteArray(Charsets.UTF_8)
      val encrypted =
        try {
          BackupCrypto.encrypt(plain, password)
        } finally {
          Arrays.fill(plain, 0)
        }
      val out = resolver.openOutputStream(uri, "wt") ?: throw IllegalStateException("no stream")
      out.use { it.write(encrypted) }
      val result = Arguments.createMap()
      result.putBoolean("saved", true)
      result.putString("name", displayName(uri) ?: "")
      result.putDouble("bytes", encrypted.size.toDouble())
      promise.resolve(result)
    } catch (e: Exception) {
      // Do not leave an empty / partial file behind.
      try {
        DocumentsContract.deleteDocument(resolver, uri)
      } catch (ignored: Exception) {
      }
      promise.reject("E_IO", "Could not save the backup file")
    } finally {
      Arrays.fill(password, '\u0000')
    }
  }

  private fun inspectPicked(uri: Uri, promise: Promise) {
    try {
      val head = ByteArray(BackupCrypto.HEADER_BYTES)
      val read =
        reactApplicationContext.contentResolver.openInputStream(uri)?.use { readUpTo(it, head) }
          ?: throw IllegalStateException("no stream")
      if (read < BackupCrypto.HEADER_BYTES) throw BackupCrypto.NotBackupException()
      BackupCrypto.checkHeader(head)
      val size = fileSize(uri)
      if (size != null && size > MAX_FILE_BYTES) throw BackupCrypto.NotBackupException()
      pickedUri = uri
      val result = Arguments.createMap()
      result.putString("uri", uri.toString())
      result.putString("name", displayName(uri) ?: "")
      result.putDouble("bytes", (size ?: -1L).toDouble())
      promise.resolve(result)
    } catch (e: BackupCrypto.TooNewException) {
      promise.reject("E_TOO_NEW", "This backup was made by a newer version of Tracker")
    } catch (e: BackupCrypto.NotBackupException) {
      promise.reject("E_NOT_BACKUP", "This file is not a Tracker backup")
    } catch (e: Exception) {
      promise.reject("E_IO", "Could not read the backup file")
    }
  }

  private class TooLargeException : Exception()

  private fun readAll(uri: Uri): ByteArray {
    val input =
      reactApplicationContext.contentResolver.openInputStream(uri)
        ?: throw IllegalStateException("no stream")
    input.use { stream ->
      val out = ByteArrayOutputStream()
      val buffer = ByteArray(64 * 1024)
      var total = 0L
      while (true) {
        val n = stream.read(buffer)
        if (n < 0) break
        total += n
        if (total > MAX_FILE_BYTES) throw TooLargeException()
        out.write(buffer, 0, n)
      }
      return out.toByteArray()
    }
  }

  private fun readUpTo(stream: InputStream, target: ByteArray): Int {
    var offset = 0
    while (offset < target.size) {
      val n = stream.read(target, offset, target.size - offset)
      if (n < 0) break
      offset += n
    }
    return offset
  }

  private fun displayName(uri: Uri): String? = queryColumn(uri, OpenableColumns.DISPLAY_NAME)?.let {
    it as? String
  }

  private fun fileSize(uri: Uri): Long? = (queryColumn(uri, OpenableColumns.SIZE) as? Long)

  private fun queryColumn(uri: Uri, column: String): Any? =
    try {
      reactApplicationContext.contentResolver.query(uri, arrayOf(column), null, null, null)?.use {
        cursor ->
        if (!cursor.moveToFirst()) return@use null
        val index = cursor.getColumnIndex(column)
        if (index < 0 || cursor.isNull(index)) null
        else if (column == OpenableColumns.SIZE) cursor.getLong(index)
        else cursor.getString(index)
      }
    } catch (e: Exception) {
      null
    }

  companion object {
    private const val REQUEST_SAVE = 47_301
    private const val REQUEST_OPEN = 47_302
    private const val MIME_TYPE = "application/octet-stream"
    private const val DEFAULT_NAME = "tracker-backup.trkbak"
    /** No real backup comes near this; anything bigger is refused unread. */
    private const val MAX_FILE_BYTES = 64L * 1024 * 1024

    /** Letters, digits, dot, dash and underscore only; must end in .trkbak. */
    fun safeFileName(name: String): String {
      val cleaned = name.filter { it.isLetterOrDigit() || it == '.' || it == '-' || it == '_' }
      if (cleaned.isEmpty() || cleaned.length > 80) return DEFAULT_NAME
      return if (cleaned.endsWith(".trkbak")) cleaned else "$cleaned.trkbak"
    }
  }
}
