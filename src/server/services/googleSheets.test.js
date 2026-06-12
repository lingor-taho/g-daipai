const assert = require('assert/strict');
const path = require('path');
const {
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  buildAppendRowsFormatRequest,
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

function testAppendRowFormatSetsBlackText() {
  const backgroundColor = { red: 1, green: 0.9, blue: 0.8 };
  const request = buildAppendRowsFormatRequest({
    sheetId: 123,
    startRowIndex: 4,
    endRowIndex: 6,
    backgroundColor
  });

  assert.deepEqual(request.repeatCell.range, {
    sheetId: 123,
    startRowIndex: 4,
    endRowIndex: 6,
    startColumnIndex: 0,
    endColumnIndex: 10
  });
  assert.deepEqual(
    request.repeatCell.cell.userEnteredFormat.textFormat.foregroundColor,
    { red: 0, green: 0, blue: 0 }
  );
  assert.deepEqual(request.repeatCell.cell.userEnteredFormat.backgroundColor, backgroundColor);
  assert.match(request.repeatCell.fields, /userEnteredFormat\.textFormat\.foregroundColor/);
  assert.match(request.repeatCell.fields, /userEnteredFormat\.backgroundColor/);
}

async function run() {
  testCredentialPathUsesGoogleApplicationCredentials();
  testCredentialPathIsEmptyWithoutFileEnv();
  testExtractSpreadsheetIdFromUrl();
  testAppendRowFormatSetsBlackText();
  await testApplyConfigFromDbOverridesEnv();
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
