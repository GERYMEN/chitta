package com.tracker

import androidx.core.content.FileProvider

/**
 * R4c: own FileProvider subclass (avoids a manifest-merge clash with any
 * library that also declares androidx FileProvider). Serves only
 * cache/feedback/ (res/xml/feedback_paths.xml), read-only, per-share grants.
 */
class FeedbackFileProvider : FileProvider()
