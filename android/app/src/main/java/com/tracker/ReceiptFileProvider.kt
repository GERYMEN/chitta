package com.tracker

import androidx.core.content.FileProvider

/**
 * R11: own FileProvider subclass for receipt images. Serves only files/receipts/
 * (res/xml/receipt_paths.xml), never exported, no per-share grants: the in-app
 * viewer is the same app. Not a permission.
 */
class ReceiptFileProvider : FileProvider()
