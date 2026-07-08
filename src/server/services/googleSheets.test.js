const assert = require('assert/strict');
const path = require('path');
const {
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  buildEnsureRemarkColumnRequest,
  buildAppendRowsFormatRequest,
  buildFindRowsByProductIdWithAnyColorPath,
  extractSpreadsheetId,
  getGoogleSheetsCredentialPath,
  getSheetConfig,
  normalizeGoogleSheetName,
  updateRowsByProductId
} = require('./googleSheets');

function withEnv(key, value, fn) {
  const oldValue = process.env[key];
  const restore = () => {
    if (oldValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = oldValue;
    }
  };
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
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

async function testMojibakeSheetNameFallsBackToDefault() {
  assert.equal(normalizeGoogleSheetName('-\u4ee3\u62cd\u8868-'), '-\u4ee3\u62cd\u8868-');
  assert.equal(normalizeGoogleSheetName('-\ufffd\ufffd\ufffd\ufffd-'), '');
  assert.equal(normalizeGoogleSheetName('-\u6d60\uff46\u5abf\u741b-'), '');
  applyGoogleSheetsConfig({ googleSheetId: '', googleCredentialPath: '', googleSheetName: '-\ufffd\ufffd\ufffd\ufffd-' });
  assert.equal(getSheetConfig().sheetName, '-Ygao-');
  applyGoogleSheetsConfig({ googleSheetId: '', googleCredentialPath: '', googleSheetName: '' });
}

async function testUpdateRowsByProductIdSkipsWhenUnconfigured() {
  applyGoogleSheetsConfig({ googleSheetId: '', googleCredentialPath: '', googleSheetName: '' });
  await withEnv('GOOGLE_APPLICATION_CREDENTIALS', undefined, async () => {
    await withEnv('GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON', undefined, async () => {
      await withEnv('GOOGLE_SHEETS_CLIENT_EMAIL', undefined, async () => {
        const result = await updateRowsByProductId('m123456789', ['2026-06-16']);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'google sheets not configured');
      });
    });
  });
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
    endColumnIndex: 11
  });
  assert.deepEqual(
    request.repeatCell.cell.userEnteredFormat.textFormat.foregroundColor,
    { red: 0, green: 0, blue: 0 }
  );
  assert.deepEqual(request.repeatCell.cell.userEnteredFormat.backgroundColor, backgroundColor);
  assert.match(request.repeatCell.fields, /userEnteredFormat\.textFormat\.foregroundColor/);
  assert.match(request.repeatCell.fields, /userEnteredFormat\.backgroundColor/);
}

function testBuildEnsureRemarkColumnRequestInsertsKColumn() {
  const request = buildEnsureRemarkColumnRequest({ sheetId: 123 });
  assert.deepEqual(request.insertDimension.range, {
    sheetId: 123,
    dimension: 'COLUMNS',
    startIndex: 10,
    endIndex: 11
  });
  assert.equal(request.insertDimension.inheritFromBefore, true);
}

function testAppendRowFormatUsesWhiteBackgroundByDefault() {
  const request = buildAppendRowsFormatRequest({
    sheetId: 123,
    startRowIndex: 1,
    endRowIndex: 2
  });

  assert.deepEqual(
    request.repeatCell.cell.userEnteredFormat.backgroundColor,
    { red: 1, green: 1, blue: 1 }
  );
  assert.deepEqual(
    request.repeatCell.cell.userEnteredFormat.textFormat.foregroundColor,
    { red: 0, green: 0, blue: 0 }
  );
  assert.match(request.repeatCell.fields, /userEnteredFormat\.backgroundColor/);
  assert.match(request.repeatCell.fields, /userEnteredFormat\.textFormat\.foregroundColor/);
}

function testFindRowsByProductIdWithAnyColorPathReadsOnlyColumnC() {
  const path = buildFindRowsByProductIdWithAnyColorPath({
    spreadsheetId: 'sheet-id',
    sheetName: '-Ygao-'
  });

  assert.match(path, /ranges=-Ygao-!C%3AC/);
  assert.doesNotMatch(path, /A%3AK/);
  assert.match(path, /backgroundColor/);
}

async function run() {
  testCredentialPathUsesGoogleApplicationCredentials();
  testCredentialPathIsEmptyWithoutFileEnv();
  testExtractSpreadsheetIdFromUrl();
  testAppendRowFormatSetsBlackText();
  testAppendRowFormatUsesWhiteBackgroundByDefault();
  testFindRowsByProductIdWithAnyColorPathReadsOnlyColumnC();
  testBuildEnsureRemarkColumnRequestInsertsKColumn();
  await testApplyConfigFromDbOverridesEnv();
  await testMojibakeSheetNameFallsBackToDefault();
  await testUpdateRowsByProductIdSkipsWhenUnconfigured();
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
