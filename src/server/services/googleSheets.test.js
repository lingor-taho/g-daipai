const assert = require('assert/strict');
const path = require('path');
const {
  appendRows,
  productIdsFromSheetCell,
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  buildEnsureRemarkColumnRequest,
  buildAppendRowsFormatRequest,
  buildFindRowsByProductIdWithAnyColorPath,
  executeGoogleSheetsRequestWithRetry,
  findRowsByProductIdsWithAnyColor,
  extractSpreadsheetId,
  fetchWithGoogleSheetsTimeout,
  getGoogleSheetsCredentialPath,
  getGoogleSheetsTimeoutMs,
  getSheetConfig,
  isRetryableGoogleSheetsError,
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

async function testReceiptColorBatchAndQuotaCooldown() {
  let calls = 0, now = 1000;
  const config = { spreadsheetId: 'receipt-test', sheetName: 'test' };
  const cell = (id, yellow) => ({ formattedValue: id, userEnteredFormat: { backgroundColor: yellow ? { red: 1, green: 1 } : { red: 1 } } });
  const options = { config, now: () => now, async request(path) {
    calls++;
    assert.match(path, /C%3AC/);
    return { sheets: [{ data: [{ startRow: 2, rowData: [
      { values: [cell('a123', true)] }, { values: [cell('b456', false)] }, { values: [cell('a123', true)] }
    ] }] }] };
  } };
  const result = await findRowsByProductIdsWithAnyColor(['a123', 'b456', 'missing', 'a123'], '#ffff00', options);
  assert.equal(calls, 1);
  assert.deepEqual(result.a123, { matched: true, rows: [{ rowNumber: 3 }, { rowNumber: 5 }] });
  assert.equal(result.b456.matched, false);
  assert.equal(result.missing.matched, false);
  await findRowsByProductIdsWithAnyColor([], '#ffff00', options);
  assert.equal(calls, 1);
  const quota = new Error('quota'); quota.googleSheetsStatus = 429;
  const limited = { ...options, async request() { calls++; throw quota; } };
  await assert.rejects(() => findRowsByProductIdsWithAnyColor(['a123'], '#ffff00', limited), /quota/);
  await assert.rejects(() => findRowsByProductIdsWithAnyColor(['a123'], '#ffff00', options), /quota/);
  assert.equal(calls, 2);
  now += 60000;
  await findRowsByProductIdsWithAnyColor(['a123'], '#ffff00', options);
  assert.equal(calls, 3);
  let retryCalls = 0;
  await assert.rejects(() => executeGoogleSheetsRequestWithRetry(async () => { retryCalls++; throw quota; }, {
    skipQuotaRetry: true, wait: async () => { throw new Error('must not immediately retry'); }
  }), /quota/);
  assert.equal(retryCalls, 1);
}

async function testGoogleSheetsRetryableFailureRetriesOnce() {
  let attempts = 0;
  let waits = 0;
  const result = await executeGoogleSheetsRequestWithRetry(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('rate limited');
      error.googleSheetsStatus = 429;
      throw error;
    }
    return { success: true };
  }, {
    wait: async () => {
      waits += 1;
    }
  });

  assert.deepEqual(result, { success: true });
  assert.equal(attempts, 2);
  assert.equal(waits, 1);
}

async function testGoogleSheetsRetryStopsAfterSecondFailure() {
  let attempts = 0;
  await assert.rejects(
    () => executeGoogleSheetsRequestWithRetry(async () => {
      attempts += 1;
      const error = new Error('server unavailable');
      error.googleSheetsStatus = 503;
      throw error;
    }, { wait: async () => {} }),
    /server unavailable/
  );
  assert.equal(attempts, 2);
}

async function testGoogleSheetsNonRetryableFailureDoesNotRetry() {
  let attempts = 0;
  await assert.rejects(
    () => executeGoogleSheetsRequestWithRetry(async () => {
      attempts += 1;
      const error = new Error('permission denied');
      error.googleSheetsStatus = 403;
      throw error;
    }, { wait: async () => {} }),
    /permission denied/
  );
  assert.equal(attempts, 1);
  assert.equal(isRetryableGoogleSheetsError({ googleSheetsNetworkError: true }), true);
}

async function testGoogleSheetsFetchTimesOutAndDoesNotRetry() {
  const error = await fetchWithGoogleSheetsTimeout('https://sheets.googleapis.com/test', {}, 'Google Sheets API request', {
    timeoutMs: 5,
    fetch: async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const abortError = new Error('aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      }, { once: true });
    })
  }).then(() => null, caught => caught);

  assert.match(error.message, /Google Sheets API request timed out after 5ms/);
  assert.equal(error.code, 'GOOGLE_SHEETS_TIMEOUT');
  assert.equal(error.googleSheetsTimeout, true);
  assert.equal(isRetryableGoogleSheetsError(error), false);
}

function testGoogleSheetsTimeoutUsesBoundedEnvironmentValue() {
  withEnv('GOOGLE_SHEETS_TIMEOUT_MS', undefined, () => {
    assert.equal(getGoogleSheetsTimeoutMs(), 8000);
  });
  withEnv('GOOGLE_SHEETS_TIMEOUT_MS', '12000', () => {
    assert.equal(getGoogleSheetsTimeoutMs(), 12000);
  });
  withEnv('GOOGLE_SHEETS_TIMEOUT_MS', '100', () => {
    assert.equal(getGoogleSheetsTimeoutMs(), 1000);
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

function testSheetProductIdsMatchExactly() {
  for (const cell of [
    { formattedValue: 'R1243992660' },
    { userEnteredValue: { formulaValue: '=HYPERLINK("https://auctions.yahoo.co.jp/jp/auction/r1243992660","商品")' } },
    { hyperlink: 'https://page.auctions.yahoo.co.jp/jp/auction/r1243992660?x=1', formattedValue: '商品' },
    { textFormatRuns: [{ format: { link: { uri: 'https://auctions.yahoo.co.jp/jp/auction/r1243992660' } } }] }
  ]) assert.deepEqual([...productIdsFromSheetCell(cell)], ['r1243992660']);
  assert.deepEqual([...productIdsFromSheetCell({ userEnteredValue: { numberValue: 1240369268 } })], ['1240369268']);
  for (const text of ['备注 r1243992660', 'r12439926600', 'https://example.com/r1243992660']) {
    assert.equal(productIdsFromSheetCell({ formattedValue: text }).has('r1243992660'), false);
  }
}

async function testAppendChecksExistingRowsAndUncertainResults() {
  const ids = ['r1243992660', 'l1244119177'];
  const rows = ids.map(id => ['', '', `https://auctions.yahoo.co.jp/jp/auction/${id}`, 'title']);
  let present = [ids[0]];
  let appendCalls = 0;
  let readError = null;
  let uncertain = false;
  let formatFailure = false;
  const appended = [];
  const options = {
    config: { spreadsheetId: 'test-only', sheetName: 'orders' },
    prepareSheet: async () => {},
    getSheetId: async () => 1,
    request: async (url, requestOptions) => {
      if (url.endsWith(':batchUpdate')) {
        if (formatFailure) throw new Error('format failed');
        return {};
      }
      if (readError) throw readError;
      assert.ok(decodeURIComponent(url).includes("'orders'!C:C"));
      return { sheets: [{ data: [{ rowData: present.map(id => ({ values: [{ formattedValue: id }] })) }] }] };
    },
    appendRequest: async (url, requestOptions) => {
      appendCalls++;
      const values = JSON.parse(requestOptions.body).values;
      appended.push(values);
      present.push(...values.map(row => row[2].split('/').pop()));
      if (uncertain) throw Object.assign(new Error('response lost after append'), { googleSheetsNetworkError: true });
      return { updates: { updatedRows: values.length, updatedRange: 'orders!A2:K3' } };
    }
  };
  const partial = await appendRows({ rows, productIds: ids, backgroundColor: '#ffff00' }, options);
  assert.equal(partial.existingRows, 1);
  assert.equal(partial.appendedRows, 1);
  assert.deepEqual(appended[0], [rows[1]]);
  const existing = await appendRows({ rows, productIds: ids }, options);
  assert.equal(existing.alreadyExists, true);
  assert.equal(existing.skipped, false);
  assert.equal(existing.appendedRows, 0);
  assert.equal(appendCalls, 1);

  present = [];
  readError = new Error('read failed');
  await assert.rejects(appendRows({ rows, productIds: ids }, options), /read failed/);
  assert.equal(appendCalls, 1);
  readError = null;
  uncertain = true;
  await assert.rejects(appendRows({ rows, productIds: ids }, options), /response lost/);
  assert.equal(appendCalls, 2, 'never blindly retry an uncertain append');
  uncertain = false;
  assert.equal((await appendRows({ rows, productIds: ids }, options)).alreadyExists, true);
  assert.equal(appendCalls, 2);

  present = [];
  formatFailure = true;
  const formatted = await appendRows({ rows, productIds: ids }, options);
  assert.equal(formatted.appendedRows, 2);
  assert.match(formatted.formatWarning, /format failed/);
  assert.equal(formatted.skipped, false);
  formatFailure = false;

  present = [];
  const beforeConcurrent = appendCalls;
  const results = await Promise.all([
    appendRows({ rows, productIds: ids }, options),
    appendRows({ rows, productIds: ids }, options)
  ]);
  assert.equal(appendCalls, beforeConcurrent + 1);
  assert.equal(results[1].alreadyExists, true);
  await assert.rejects(appendRows({ rows, productIds: [ids[1], ids[0]] }, options), /matching product ID/);
}

async function run() {
  testSheetProductIdsMatchExactly();
  await testAppendChecksExistingRowsAndUncertainResults();
  testCredentialPathUsesGoogleApplicationCredentials();
  testCredentialPathIsEmptyWithoutFileEnv();
  testExtractSpreadsheetIdFromUrl();
  testAppendRowFormatSetsBlackText();
  testAppendRowFormatUsesWhiteBackgroundByDefault();
  testFindRowsByProductIdWithAnyColorPathReadsOnlyColumnC();
  testBuildEnsureRemarkColumnRequestInsertsKColumn();
  testGoogleSheetsTimeoutUsesBoundedEnvironmentValue();
  await testApplyConfigFromDbOverridesEnv();
  await testMojibakeSheetNameFallsBackToDefault();
  await testUpdateRowsByProductIdSkipsWhenUnconfigured();
  await testReceiptColorBatchAndQuotaCooldown();
  await testGoogleSheetsRetryableFailureRetriesOnce();
  await testGoogleSheetsRetryStopsAfterSecondFailure();
  await testGoogleSheetsNonRetryableFailureDoesNotRetry();
  await testGoogleSheetsFetchTimesOutAndDoesNotRetry();
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
