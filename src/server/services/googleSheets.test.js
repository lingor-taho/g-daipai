const assert = require('assert/strict');
const path = require('path');
const {
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  extractSpreadsheetId,
  getGoogleSheetsCredentialPath,
  getSheetConfig
} = require('./googleSheets');

function withEnv(key, value, fn) {
  const oldValue = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    if (oldValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = oldValue;
    }
  }
}

function testCredentialPathUsesGoogleApplicationCredentials() {
  withEnv('GOOGLE_APPLICATION_CREDENTIALS', 'config/google-service-account.json', () => {
    assert.equal(
      getGoogleSheetsCredentialPath(),
      path.resolve('config/google-service-account.json')
    );
  });
}

function testCredentialPathIsEmptyWithoutFileEnv() {
  applyGoogleSheetsConfig({ googleCredentialPath: '' });
  withEnv('GOOGLE_APPLICATION_CREDENTIALS', undefined, () => {
    assert.equal(getGoogleSheetsCredentialPath(), '');
  });
}

function testExtractSpreadsheetIdFromUrl() {
  assert.equal(
    extractSpreadsheetId('https://docs.google.com/spreadsheets/d/abc123-XYZ/edit?gid=0#gid=0'),
    'abc123-XYZ'
  );
  assert.equal(extractSpreadsheetId('abc123-XYZ'), 'abc123-XYZ');
  assert.equal(extractSpreadsheetId(''), '');
}

async function testApplyConfigFromDbOverridesEnv() {
  const fakeDb = {
    async getAll() {
      return [
        { key: 'google_sheets_spreadsheet_id', value: 'sheet-from-db' },
        { key: 'google_application_credentials', value: 'config/db-service-account.json' },
        { key: 'google_sheets_sheet_name', value: '-custom-sheet-' }
      ];
    }
  };
  await applyGoogleSheetsConfigFromDb(fakeDb);
  assert.equal(getSheetConfig().spreadsheetId, 'sheet-from-db');
  assert.equal(getSheetConfig().sheetName, '-custom-sheet-');
  assert.equal(getGoogleSheetsCredentialPath(), path.resolve('config/db-service-account.json'));
  applyGoogleSheetsConfig({ googleSheetId: '', googleCredentialPath: '', googleSheetName: '' });
}

async function run() {
  testCredentialPathUsesGoogleApplicationCredentials();
  testCredentialPathIsEmptyWithoutFileEnv();
  testExtractSpreadsheetIdFromUrl();
  await testApplyConfigFromDbOverridesEnv();
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
