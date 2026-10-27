/**
 * Jest manual mock for @react-native-community/datetimepicker. The real
 * package reads native datetime-picker modules at import time, which are
 * undefined under the react-native jest preset. The default export is a
 * functional component (renders nothing), and the imperative Android API is
 * stubbed.
 */
const React = require('react');

const DateTimePicker = () => null;
DateTimePicker.displayName = 'DateTimePicker';

const DateTimePickerAndroid = {
  open: jest.fn(),
  dismiss: jest.fn(async () => true),
};

module.exports = DateTimePicker;
module.exports.default = DateTimePicker;
module.exports.DateTimePickerAndroid = DateTimePickerAndroid;
