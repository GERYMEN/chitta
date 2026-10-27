# Task: Get Tracker Android build fully green

## Ground facts (already verified — do not re-derive)

- Project root: `/Users/mohammedsiraj/Downloads/projects/experiment/Tracker`
- Android project: `/Users/mohammedsiraj/Downloads/projects/experiment/Tracker/android`
- NOT a git repo (no git worktree isolation available/needed — this is the
  only checkout, work directly in it, it's local dev machine setup, not a
  shared repo).
- JAVA_HOME: `/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home` (OpenJDK 17 via Homebrew)
- ANDROID_HOME / sdk.dir: `/opt/homebrew/share/android-commandlinetools`
  (command-line tools only, NO Android Studio GUI installed — keep it that way,
  do not install Android Studio or suggest it)
- Installed SDK packages: `platform-tools`, `platforms;android-37.0`,
  `build-tools;37.0.0`, `ndk;27.1.12297006` (matches `android/build.gradle`'s
  `compileSdkVersion=37`, `buildToolsVersion="37.0.0"`, `ndkVersion="27.1.12297006"`,
  `targetSdkVersion=36`, `minSdkVersion=24`).
- `android/local.properties` already has `sdk.dir=/opt/homebrew/share/android-commandlinetools` — don't need ANDROID_HOME env var for gradle itself, but DO still need JAVA_HOME exported for every `./gradlew` invocation (no system Java installed otherwise).
- Gradle wrapper: 9.4.1, already downloaded and cached (`~/.gradle/wrapper/dists/gradle-9.4.1-bin/.../gradle-9.4.1`). AGP + Kotlin Gradle plugin classpath already resolved once successfully — those should be cached in `~/.gradle/caches` now.
- **Network quirk**: large single-file downloads (Gradle distribution zip, Android NDK zip) over plain JVM `HttpURLConnection` (used by the old `sdkmanager` tool and the Gradle wrapper's bootstrap downloader) are unreliable here — they either hang indefinitely or get "Connection reset" partway through. `curl` to the same URLs works fine and faster (~4-5 MB/s), including resuming with `-C -` and `--retry`. **If any future SDK package or large dependency needs fetching and the normal tool (sdkmanager/gradle) stalls or resets, prefer manually curl-downloading the artifact and placing it in the expected cache/SDK location instead of retrying the built-in downloader repeatedly.**
- Already fixed: NDK 27.1.12297006 was corrupted/incomplete from a failed `sdkmanager` download (missing `source.properties`) — re-downloaded via curl + manually unzipped into `/opt/homebrew/share/android-commandlinetools/ndk/27.1.12297006/` (flat, i.e. `source.properties` sits directly in that directory, not nested under an `android-ndk-r27b/` subfolder). This is now correct — verified `cat .../ndk/27.1.12297006/source.properties` shows `Pkg.Revision = 27.1.12297006`.
- Already fixed: `react-native-sqlite-storage` was removed (its `platforms/android/build.gradle` called `jcenter()`, which no longer exists in modern Gradle — the package is abandoned). Replaced with `@op-engineering/op-sqlite` (actively maintained, JSI/New-Arch native SQLite, autolinked, no manual gradle wiring documented as required). **No application code uses either library yet** (Milestone 2 / SQLite repositories haven't been built) — this was a pure dependency swap, nothing to migrate.
- App has New Architecture enabled (`android/gradle.properties` → `newArchEnabled=true`), RN version 0.87.1, React 19.2.3.
- Other native-ish deps currently in `package.json`: `@react-navigation/native`, `@react-navigation/bottom-tabs`, `@react-navigation/native-stack`, `react-native-screens`, `react-native-safe-area-context`, `react-native-vector-icons` (fonts manually copied into `android/app/src/main/assets/fonts/` already, gradle fonts.gradle already applied in `android/app/build.gradle`), `@react-native-community/datetimepicker`, `zustand`, `zod`, `react-hook-form`. `react-native-reanimated`, `react-native-worklets`, `@gorhom/bottom-sheet`, `react-native-gesture-handler` were deliberately REMOVED earlier this session due to a real upstream version mismatch (reanimated 4.7.0's source expects worklets APIs not present in the only published stable worklets 0.13.0) — do NOT reintroduce these three as a "fix" for anything; if a build error mentions them, it means something else re-added them (check `package.json` / lockfile), report it as a finding rather than silently resolving by reinstalling.
- Goal: `cd android && JAVA_HOME=<above> ./gradlew assembleDebug` reaches `BUILD SUCCESSFUL`, producing `android/app/build/outputs/apk/debug/app-debug.apk`. No emulator/device available in this environment — do not attempt `installDebug`, `run-android`, or anything requiring a connected device/emulator. Static build success (APK produced) is the finish line for this task.
- Deprecation warnings from AGP about `android.builtInKotlin`, `android.newDsl`, obsolete variant APIs (`applicationVariants` etc.) are expected noise from the RN 0.87 template on a newer AGP — NOT build failures, ignore them, do not "fix" by editing `android.newDsl=false` or similar unless they start causing an actual FAILURE.

## Phase table

| # | phase | output file | status |
|---|-------|--------|--------|
| 1 | build-to-green | 01-build-to-green.md | DONE — BUILD SUCCESSFUL first try, zero changes needed, APK 161,349,854 bytes |
| 2 | verify | 02-verify.md | superseded — orchestrator installed + ran on physical device directly (see Decisions log) |

## Decisions log

- 2026-10-04: Swapped `react-native-sqlite-storage` → `@op-engineering/op-sqlite` (orchestrator decision, not executor) — abandoned package, broken on modern Gradle, zero existing call sites to migrate.
- 2026-10-04: Confirmed `npm audit`'s 49 high-severity findings are all pre-existing devDependency/tooling chain (jest, RN CLI, metro — fast-glob/micromatch ReDoS class advisories), unrelated to the op-sqlite swap, not shipped in the app bundle. Not actioned.
