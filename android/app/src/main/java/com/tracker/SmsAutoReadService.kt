package com.tracker

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.LifecycleState
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener

/**
 * R5 auto-read service (not a foreground service, no notification).
 *
 * 1. Waits DELAY_MS after the broadcast (the SMS provider writes the inbox row
 *    after SMS_RECEIVED); further broadcasts inside the wait restart it, so a
 *    burst becomes one run.
 * 2. App in front (React context RESUMED): emits "TrackerSmsReceived" (no
 *    payload) — JS coalesces and runs the sync through its single-flight guard.
 * 3. Otherwise: starts the RN core headless task "TrackerSmsAutoRead" (30 s
 *    timeout), creating the React instance if the app was killed.
 *
 * Deliberately NOT HeadlessJsTaskService: its startTask() always takes a
 * PARTIAL_WAKE_LOCK, which needs android.permission.WAKE_LOCK — not approved
 * (RECEIVE_SMS is the only new permission). Without a wake lock the run is
 * short and best-effort; if the device dozes, the next sync catches up.
 * Nothing here reads, logs or passes SMS content.
 */
class SmsAutoReadService : Service(), HeadlessJsTaskEventListener {
  private val handler = Handler(Looper.getMainLooper())
  private val activeTasks = mutableSetOf<Int>()
  private var taskContext: HeadlessJsTaskContext? = null
  private val runner = Runnable { dispatch() }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    handler.removeCallbacks(runner)
    handler.postDelayed(runner, DELAY_MS)
    return START_NOT_STICKY
  }

  private fun reactHost() = (application as? ReactApplication)?.reactHost

  private fun dispatch() {
    try {
      val host = reactHost()
      if (host == null) {
        stopSelf()
        return
      }
      val context = host.currentReactContext
      if (context != null && context.lifecycleState == LifecycleState.RESUMED && context.hasActiveReactInstance()) {
        context.emitDeviceEvent(EVENT_NAME, null)
        stopSelf()
        return
      }
      if (context != null) {
        startTask(context)
      } else {
        host.addReactInstanceEventListener(
          object : ReactInstanceEventListener {
            override fun onReactContextInitialized(context: ReactContext) {
              host.removeReactInstanceEventListener(this)
              handler.post { startTask(context) }
            }
          },
        )
        host.start()
      }
    } catch (e: Exception) {
      stopSelf()
    }
  }

  private fun startTask(context: ReactContext) {
    try {
      val tasks = HeadlessJsTaskContext.getInstance(context)
      taskContext = tasks
      tasks.addTaskEventListener(this)
      val id = tasks.startTask(
        HeadlessJsTaskConfig(TASK_NAME, Arguments.createMap(), TASK_TIMEOUT_MS, true),
      )
      activeTasks.add(id)
    } catch (e: Exception) {
      stopSelf()
    }
  }

  override fun onHeadlessJsTaskStart(taskId: Int) = Unit

  override fun onHeadlessJsTaskFinish(taskId: Int) {
    activeTasks.remove(taskId)
    if (activeTasks.isEmpty()) stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(runner)
    taskContext?.removeTaskEventListener(this)
    taskContext = null
    super.onDestroy()
  }

  companion object {
    const val EVENT_NAME = "TrackerSmsReceived"
    const val TASK_NAME = "TrackerSmsAutoRead"
    private const val DELAY_MS = 4000L
    private const val TASK_TIMEOUT_MS = 30000L
  }
}
