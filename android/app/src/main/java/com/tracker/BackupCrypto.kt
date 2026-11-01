package com.tracker

import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.Arrays
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * R4e: the backup file format. Pure Kotlin + javax.crypto only (no Android
 * imports), so it can run on any JVM.
 *
 * File layout (all integers big-endian):
 *
 *   offset  size  field
 *   0       5     magic "TRKBK" (ASCII)
 *   5       1     format version (1)
 *   6       4     PBKDF2 iteration count (Int)
 *   10      16    salt (random)
 *   26      12    GCM IV (random)
 *   38      n+16  AES-256-GCM ciphertext of the UTF-8 JSON + 128-bit tag
 *
 * Key = PBKDF2WithHmacSHA256(password, salt, iterations, 256 bits).
 * The 38-byte header is passed to GCM as associated data, so changing any
 * header byte (iterations, salt, IV, version) fails the tag check like a
 * damaged ciphertext does.
 *
 * Privacy: nothing here logs. The password char array is the caller's to
 * zero; PBEKeySpec.clearPassword() and the derived key bytes are cleared here.
 */
object BackupCrypto {
  val MAGIC: ByteArray = "TRKBK".toByteArray(Charsets.US_ASCII)
  const val FORMAT_VERSION: Int = 1
  /** Iterations written into new files. */
  const val ITERATIONS: Int = 600_000
  /** Files with fewer iterations than this are not ours (prompt minimum). */
  const val MIN_ITERATIONS: Int = 210_000
  /** Upper bound so a crafted header cannot make the phone hash for minutes. */
  const val MAX_ITERATIONS: Int = 5_000_000
  const val SALT_BYTES: Int = 16
  const val IV_BYTES: Int = 12
  const val TAG_BITS: Int = 128
  private const val KEY_BITS: Int = 256
  val HEADER_BYTES: Int = MAGIC.size + 1 + 4 + SALT_BYTES + IV_BYTES
  private val TAG_BYTES: Int = TAG_BITS / 8

  /** Not a Tracker backup (bad magic, bad header, too short). */
  class NotBackupException : Exception("This file is not a Tracker backup")

  /** Made by a newer app (format version above FORMAT_VERSION). */
  class TooNewException : Exception("This backup was made by a newer version of Tracker")

  /** GCM tag check failed: wrong password OR a damaged file (indistinguishable). */
  class BadPasswordException : Exception("Wrong password or damaged file")

  private val random = SecureRandom()

  /** Cheap header check, used right after the user picks a file. */
  fun checkHeader(head: ByteArray) {
    if (head.size < MAGIC.size + 1) throw NotBackupException()
    if (!Arrays.equals(head.copyOfRange(0, MAGIC.size), MAGIC)) throw NotBackupException()
    val version = head[MAGIC.size].toInt() and 0xFF
    if (version > FORMAT_VERSION) throw TooNewException()
    if (version < 1) throw NotBackupException()
  }

  fun encrypt(plaintext: ByteArray, password: CharArray): ByteArray =
    encrypt(plaintext, password, ITERATIONS, randomBytes(SALT_BYTES), randomBytes(IV_BYTES))

  /** Deterministic variant (fixed salt/IV/iterations) — for tests only. */
  fun encrypt(
    plaintext: ByteArray,
    password: CharArray,
    iterations: Int,
    salt: ByteArray,
    iv: ByteArray,
  ): ByteArray {
    require(salt.size == SALT_BYTES && iv.size == IV_BYTES)
    val header =
      ByteBuffer.allocate(HEADER_BYTES)
        .put(MAGIC)
        .put(FORMAT_VERSION.toByte())
        .putInt(iterations)
        .put(salt)
        .put(iv)
        .array()
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val key = deriveKey(password, salt, iterations)
    try {
      cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
    } finally {
      Arrays.fill(key, 0)
    }
    cipher.updateAAD(header)
    val body = cipher.doFinal(plaintext)
    return header + body
  }

  fun decrypt(file: ByteArray, password: CharArray): ByteArray {
    checkHeader(file)
    if (file.size < HEADER_BYTES + TAG_BYTES) throw NotBackupException()
    val buffer = ByteBuffer.wrap(file)
    buffer.position(MAGIC.size + 1)
    val iterations = buffer.int
    if (iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) throw NotBackupException()
    val salt = ByteArray(SALT_BYTES).also { buffer.get(it) }
    val iv = ByteArray(IV_BYTES).also { buffer.get(it) }
    val header = file.copyOfRange(0, HEADER_BYTES)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val key = deriveKey(password, salt, iterations)
    try {
      cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(TAG_BITS, iv))
    } finally {
      Arrays.fill(key, 0)
    }
    cipher.updateAAD(header)
    return try {
      cipher.doFinal(file, HEADER_BYTES, file.size - HEADER_BYTES)
    } catch (e: AEADBadTagException) {
      throw BadPasswordException()
    }
  }

  private fun deriveKey(password: CharArray, salt: ByteArray, iterations: Int): ByteArray {
    val spec = PBEKeySpec(password, salt, iterations, KEY_BITS)
    try {
      return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
    } finally {
      spec.clearPassword()
    }
  }

  private fun randomBytes(size: Int): ByteArray = ByteArray(size).also { random.nextBytes(it) }
}
