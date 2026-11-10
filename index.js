/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import { AUTO_READ_HEADLESS_TASK } from './src/native/android/sms/smsAutoRead';
import { autoReadHeadlessTask } from './src/features/sms-sync/autoRead/autoReadRunner';

AppRegistry.registerComponent(appName, () => App);
// R5: runs the normal incremental SMS sync after a new SMS arrived while the
// app was in the background (no UI). Never sees the SMS that triggered it.
AppRegistry.registerHeadlessTask(AUTO_READ_HEADLESS_TASK, () => autoReadHeadlessTask);

// R5g item 24: the rules picker takes the highest rules version whose
// min_app_version <= this app's version (safe default off-device).
import { setRulesAppVersion } from './src/features/sms-sync/rules/rulesLoader';
import { getFeedbackDeviceInfo } from './src/native/android/feedback/feedbackNative';
setRulesAppVersion(getFeedbackDeviceInfo().versionName);
