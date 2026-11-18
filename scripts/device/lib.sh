#!/usr/bin/env bash
# Shared helpers for Tracker device passes on a real (personal) phone over USB.
# Source this from a test script. COUNTS ONLY:
#  - never prints a screen dump, SMS text, names or amounts;
#  - only fixed UI labels, counts, SAME/DIFFERENT and hashes leave the phone;
#  - every tap/dump first checks that Tracker is in front (both focus lines),
#    and aborts the run when it is not;
#  - never presses HOME/BACK over another app, never unlocks the phone.
# Full step log goes to $LOG (git-ignored: ongoing/**/*.log); stdout stays short.

APP_ID="com.tracker"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG_DIR="$ROOT/ongoing/device-logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(basename "${0%.sh}")-$(date +%Y%m%d-%H%M%S).log"
IDLE_NEED="${IDLE_NEED:-30}"     # seconds Tracker/launcher must be idle in front
IDLE_MAX="${IDLE_MAX:-600}"

export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$ANDROID_HOME/platform-tools:$PATH"

PASS=0; FAIL=0; SKIP=0
log() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"; }
say() { printf '%s\n' "$*"; log "$*"; }

# ---- device -----------------------------------------------------------------
pick_device() {
  if [ -n "${SERIAL:-}" ]; then :; else
    SERIAL=$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1}')
    local n; n=$(printf '%s\n' "$SERIAL" | grep -c . || true)
    [ "$n" -eq 1 ] || { say "✖ need exactly 1 USB device in 'device' state (found $n)"; exit 1; }
  fi
  A=(adb -s "$SERIAL")
}

launcher_pkg() {
  [ -n "${_LAUNCHER:-}" ] || _LAUNCHER=$("${A[@]}" shell cmd package resolve-activity --brief \
    -a android.intent.action.MAIN -c android.intent.category.HOME 2>/dev/null | tail -1 | cut -d/ -f1 | tr -d '\r')
  echo "$_LAUNCHER"
}

# tracker | launcher | other | locked | off
front() {
  local p w cf fa l
  p=$("${A[@]}" shell dumpsys power 2>/dev/null | grep -m1 -oE 'mWakefulness=[A-Za-z]+')
  [ "$p" != "mWakefulness=Awake" ] && { echo off; return; }
  w=$("${A[@]}" shell dumpsys window 2>/dev/null)
  if echo "$w" | grep -qE 'mDreamingLockscreen=true|isKeyguardShowing=true|mShowingLockscreen=true|mKeyguardShowing=true'; then echo locked; return; fi
  cf=$(echo "$w" | grep -m1 mCurrentFocus); fa=$(echo "$w" | grep -m1 mFocusedApp)
  if [[ "$cf" == *$APP_ID* && "$fa" == *$APP_ID* ]]; then echo tracker; return; fi
  l=$(launcher_pkg)
  if [[ -n "$l" && "$cf" == *"$l"* ]]; then echo launcher; return; fi
  echo other
}

guard() {
  local f; f=$(front)
  if [ "$f" != tracker ]; then
    say "✖ ABORT: Tracker not in front ($f). Nothing else was touched."
    summary; exit 3
  fi
}

wait_idle() {   # Tracker or launcher in front, unlocked, for IDLE_NEED seconds
  local ok=0 t=0 f
  say "… waiting for the phone to be idle ${IDLE_NEED}s (unlock it, leave Tracker or home screen open)"
  while [ $t -lt "$IDLE_MAX" ]; do
    f=$(front)
    if [ "$f" = tracker ] || [ "$f" = launcher ]; then ok=$((ok+5)); else ok=0; fi
    [ $ok -ge "$IDLE_NEED" ] && { log "idle ok after ${t}s ($f)"; return 0; }
    sleep 5; t=$((t+5))
  done
  say "✖ phone not idle after ${IDLE_MAX}s (last: $f)"; summary; exit 2
}

launch() {
  case "$(front)" in
    tracker) ;;
    launcher) "${A[@]}" shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1; sleep 6 ;;
    *) say "✖ will not launch over another app"; summary; exit 3 ;;
  esac
  guard
}

# ---- screen queries (dump stays on the phone; only filtered values come back)
_nodes() {  # ERE on text|content-desc|hint (whole value) -> bounds lines
  "${A[@]}" shell "uiautomator dump /sdcard/u.xml >/dev/null 2>&1; grep -oE '<node [^>]*>' /sdcard/u.xml | grep -E '(text|content-desc|hint)=\"($1)\"' | grep -oE 'bounds=\"[^\"]*\"'; rm -f /sdcard/u.xml" | tr -d '\r'
}
_center() { sed -E 's/bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]"/\1 \2 \3 \4/' | awk '{printf "%d %d\n", ($1+$3)/2, ($2+$4)/2}'; }
screen_h() { "${A[@]}" shell wm size | tail -1 | grep -oE '[0-9]+x[0-9]+' | cut -dx -f2; }

has()   { guard; [ -n "$(_nodes "$1" | head -1)" ]; }
count() { guard; _nodes "$1" | grep -c . || true; }
tap()   { # tap ERE (first match)
  guard; local c; c=$(_nodes "$1" | head -1 | _center)
  [ -n "$c" ] || { log "notfound: $1"; return 1; }
  guard; "${A[@]}" shell input tap $c; log "tap: $1 ($c)"; sleep "${2:-1.5}"
}
# hashes of values matching ERE (values never printed); sorted, one line
hashes() {
  guard
  "${A[@]}" shell "uiautomator dump /sdcard/u.xml >/dev/null 2>&1; grep -oE '(text|content-desc)=\"($1)\"' /sdcard/u.xml; rm -f /sdcard/u.xml" | tr -d '\r' \
    | while IFS= read -r v; do printf '%s' "$v" | shasum | cut -c1-10; done | sort | tr '\n' ' '
}
# number shown in the bottom tab bar badge (0 when none). Counts are allowed.
tab_badge() {
  guard; local h; h=$(screen_h)
  "${A[@]}" shell "uiautomator dump /sdcard/u.xml >/dev/null 2>&1; grep -oE '<node [^>]*>' /sdcard/u.xml | grep -E 'text=\"[0-9]+\+?\"' | grep -oE 'text=\"[0-9]+\+?\"[^>]*bounds=\"[^\"]*\"'; rm -f /sdcard/u.xml" | tr -d '\r' \
    | sed -E 's/^text="([0-9]+)\+?".*bounds="\[[0-9]+,([0-9]+)\].*/\1 \2/' \
    | awk -v h="$h" '$2+0 > h*0.88 { print $1; found=1; exit } END { if (!found) print 0 }'
}
fatal_count() {  # FATAL/ANR lines for Tracker since $1 (phone time)
  "${A[@]}" logcat -d -v brief -T "$1" AndroidRuntime:E ActivityManager:E '*:S' 2>/dev/null | grep -E "FATAL|ANR" | grep -c "$APP_ID" || true
}
phone_time() { "${A[@]}" shell "date '+%m-%d %H:%M:%S.000'" | tr -d '\r'; }

# ---- test bookkeeping -------------------------------------------------------
begin() { CUR="$1"; say "▶ $1 — $2"; }
pass()  { PASS=$((PASS+1)); say "  ✔ PASS $CUR${1:+ — $1}"; }
fail()  { FAIL=$((FAIL+1)); say "  ✖ FAIL $CUR${1:+ — $1}"; }
skip()  { SKIP=$((SKIP+1)); say "  – SKIP $CUR${1:+ — $1}"; }
summary() { say "SUMMARY pass=$PASS fail=$FAIL skip=$SKIP · log: ${LOG#$ROOT/}"; }

# ---- gestures ---------------------------------------------------------------
swipe_up() { guard; local w h; read -r w h < <("${A[@]}" shell wm size | tail -1 | grep -oE '[0-9]+x[0-9]+' | tr x ' ')
  "${A[@]}" shell input swipe $((w/2)) $((h*70/100)) $((w/2)) $((h*35/100)) 300; sleep 0.8; }
back_if_tracker() { guard; "${A[@]}" shell input keyevent 4; sleep 1; }
# first value matching a COUNT-ONLY regex (caller must pass a regex that can
# only match fixed copy + numbers, never names or amounts)
grab_first() { guard
  "${A[@]}" shell "uiautomator dump /sdcard/u.xml >/dev/null 2>&1; grep -oE '(text|content-desc)=\"($1)\"' /sdcard/u.xml | head -1; rm -f /sdcard/u.xml" | tr -d '\r' | sed -E 's/^(text|content-desc)=//'; }
