// User preferences, saved as JSON in the app's data folder.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  sounds: true,
  notifications: true,
  theme: 'system',
  minimizeToTray: true,
  startup: false,
  boostDropCaches: false,
  alerts: true,
  effects: 'auto',
  autoUpdate: true,
  welcomed: false,
};

const file = () => path.join(app.getPath('userData'), 'preferences.json');

// Read before Chromium writes its own files there: a "Local Storage" folder means an earlier session.
const usedBefore = fs.existsSync(path.join(app.getPath('userData'), 'Local Storage'));

function load(defaultAdminMode) {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'));
    // Saved by a version without the welcome screen: the user already knows the app.
    if (!('welcomed' in saved)) saved.welcomed = true;
    return { ...DEFAULTS, adminMode: defaultAdminMode, ...saved };
  } catch {
    return { ...DEFAULTS, adminMode: defaultAdminMode, welcomed: usedBefore };
  }
}

function save(prefs) {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(prefs, null, 2));
}

module.exports = { DEFAULTS, load, save };
