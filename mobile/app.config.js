// Firebase is added only when its file is available, so the app still starts in
// Expo Go without it. On EAS the file comes from the GOOGLE_SERVICES_JSON file
// variable, because git-ignored files are not uploaded.
const fs = require('fs');

const file =
  process.env.GOOGLE_SERVICES_JSON ||
  (fs.existsSync('./google-services.json') ? './google-services.json' : null);

// An installable build without it would look fine and never notify anyone.
if (process.env.EAS_BUILD === 'true' && process.env.EAS_BUILD_PLATFORM === 'android' && !file) {
  throw new Error('GOOGLE_SERVICES_JSON is missing. Add it in the Expo project settings first.');
}

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(file ? { googleServicesFile: file } : {}),
  },
});
