#!/usr/bin/env bash
# Build a release APK and install it over USB as an UPDATE of the existing
# Tracker app (data kept). Never uninstalls, never clears data.
#
# Usage:
#   scripts/install-release-usb.sh                 # debug-signed release (owner phone)
#   scripts/install-release-usb.sh --release-key   # private release key (tester phones)
#   scripts/install-release-usb.sh --no-build      # install the last built APK again
#   scripts/install-release-usb.sh -s SERIAL       # pick a device when several are attached
#
# Signing must match what is already installed on the phone, otherwise Android
# refuses the update (INSTALL_FAILED_UPDATE_INCOMPATIBLE) and this script stops.
# The release key passwords stay in ~/.gradle/gradle.properties; this script
# never reads or prints them.
set -euo pipefail

APP_ID="com.tracker"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"

SIGNING="debug"
BUILD=1
SERIAL=""
while [ $# -gt 0 ]; do
  case "$1" in
    --release-key) SIGNING="release" ;;
    --no-build) BUILD=0 ;;
    -s) SERIAL="${2:?-s needs a serial}"; shift ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 64 ;;
  esac
  shift
done

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
command -v adb >/dev/null || { echo "adb not found (install platform-tools)" >&2; exit 1; }

# --- pick a USB device (serials with ':' are Wi-Fi/tcpip and are skipped) ---
if [ -z "$SERIAL" ]; then
  USB_DEVICES=$(adb devices | awk 'NR>1 && $2=="device" && $1 !~ /:/ {print $1}')
  COUNT=$(printf '%s\n' "$USB_DEVICES" | grep -c . || true)
  if [ "$COUNT" -eq 0 ]; then
    echo "No USB device in 'device' state." >&2
    echo "Plug in the phone, unlock it, enable USB debugging and accept the RSA prompt." >&2
    adb devices >&2
    exit 1
  elif [ "$COUNT" -gt 1 ]; then
    echo "Several USB devices attached; pick one with -s:" >&2
    printf '  %s\n' $USB_DEVICES >&2
    exit 1
  fi
  SERIAL="$USB_DEVICES"
fi
ADB=(adb -s "$SERIAL")
echo "Device: $SERIAL ($("${ADB[@]}" shell getprop ro.product.model | tr -d '\r'))"

installed_version() {
  "${ADB[@]}" shell dumpsys package "$APP_ID" 2>/dev/null \
    | grep -oE 'versionCode=[0-9]+|versionName=[^ ]+' | head -2 || true
}
BEFORE=$(installed_version | tr -d '\r' | tr '\n' ' ')
if [ -z "$BEFORE" ]; then
  echo "Note: $APP_ID is not installed on this device; this will be a fresh install."
else
  echo "Installed now: $BEFORE"
fi

# --- build ---
if [ "$BUILD" -eq 1 ]; then
  echo "Building release APK (signing: $SIGNING)..."
  GRADLE_ARGS=(assembleRelease)
  [ "$SIGNING" = "debug" ] && GRADLE_ARGS+=(-PtrackerDebugSigning)
  (cd "$ROOT/android" && ./gradlew "${GRADLE_ARGS[@]}" -q)
fi
[ -f "$APK" ] || { echo "APK not found: $APK" >&2; exit 1; }

# Show which certificate signed the APK (a public fingerprint, not a secret).
APKSIGNER=$(ls -d "$ANDROID_HOME"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)
if [ -n "$APKSIGNER" ]; then
  CERT=$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null | grep -m1 'SHA-256 digest' | awk '{print $NF}' || true)
  echo "APK: $APK"
  echo "Signed with cert SHA-256: ${CERT:-unknown}"
fi

# --- install as update (-r keeps data) ---
echo "Installing as update..."
set +e
OUT=$("${ADB[@]}" install -r "$APK" 2>&1)
RC=$?
set -e
echo "$OUT" | tail -2
if echo "$OUT" | grep -q 'INSTALL_FAILED_UPDATE_INCOMPATIBLE'; then
  echo
  echo "STOPPED: the APK's signing key does not match the installed app." >&2
  if [ "$SIGNING" = "debug" ]; then
    echo "The phone has a release-key build; retry with --release-key." >&2
  else
    echo "The phone has a debug-signed build; retry without --release-key." >&2
  fi
  echo "This script never uninstalls (that would delete the app's data)." >&2
  exit 2
fi
if [ $RC -ne 0 ] || ! echo "$OUT" | grep -q '^Success'; then
  echo "Install failed (see the line above). Nothing was uninstalled." >&2
  exit 1
fi

AFTER=$(installed_version | tr -d '\r' | tr '\n' ' ')
echo "Updated: ${BEFORE:-none} -> $AFTER"
echo "Done. Open Tracker on the phone; your data is kept."
