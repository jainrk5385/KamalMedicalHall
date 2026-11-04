const fs = require('fs');
const path = require('path');

/**
 * Extends app.json. Firebase native config is added only when the Firebase config files exist.
 * Firebase is used for Cloud Messaging and crash reporting; phone authentication is handled by the backend OTP API.
 * Put google-services.json and GoogleService-Info.plist in this folder (see README).
 */
module.exports = ({ config }) => {
  const android = path.join(__dirname, 'google-services.json');
  const ios = path.join(__dirname, 'GoogleService-Info.plist');
  const hasAndroid = fs.existsSync(android);
  const hasIos = fs.existsSync(ios);
  const plugins = [...(config.plugins ?? [])];
  if (hasAndroid || hasIos) {
    plugins.push('@react-native-firebase/app', '@react-native-firebase/messaging', '@react-native-firebase/crashlytics');
  }
  // One entry for both platforms. Android never allows plain-HTTP traffic in a built app; iOS needs static frameworks for Firebase.
  // ENABLE_R8=true (the "hardened" EAS profile) shrinks and obfuscates the native code. The rules keep what Razorpay needs by reflection.
  const r8 = process.env.ENABLE_R8 === 'true';
  const razorpayRules = ['-keepattributes *Annotation*', '-dontwarn com.razorpay.**', '-keep class com.razorpay.** {*;}', '-optimizations !method/inlining/*', '-keepclasseswithmembers class * { public void onPayment*(...); }'].join('\n');
  plugins.push(['expo-build-properties', {
    android: { usesCleartextTraffic: false, ...(r8 ? { enableProguardInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true, extraProguardRules: razorpayRules } : {}) },
    ...(hasAndroid || hasIos ? { ios: { useFrameworks: 'static' } } : {}),
  }]);
  return {
    ...config,
    plugins,
    ios: { ...config.ios, ...(hasIos ? { googleServicesFile: './GoogleService-Info.plist' } : {}) },
    android: { ...config.android, ...(hasAndroid ? { googleServicesFile: './google-services.json' } : {}) },
    extra: { ...config.extra, apiUrl: process.env.EXPO_PUBLIC_API_URL },
  };
};
