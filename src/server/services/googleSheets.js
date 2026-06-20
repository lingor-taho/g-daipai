const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_SPREADSHEET_ID = '1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4';
const DEFAULT_SHEET_NAME = '-Ygao-';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_HEADERS = ['落札日期', '用户名', '商品链接', '商品标题', '落札价', '运费', '同捆运费', '总价', '物流', '单号'];
const DEFAULT_COLUMN_WIDTHS = [96, 110, 210, 360, 90, 100, 110, 90, 120, 150];
const DEFAULT_APPEND_TEXT_COLOR = { red: 0, green: 0, blue: 0 };
const DEFAULT_APPEND_BACKGROUND_COLOR = { red: 1, green: 1, blue: 1 };

let cachedToken = null;
let runtimeConfig = {
  googleSheetId: '',
  googleCredentialPath: '',
  googleSheetName: ''
};

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function isGoogleSheetsConfigured() {
  return Boolean(
    process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON ||
    runtimeConfig.googleCredentialPath ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL
  );
}

function getSheetConfig() {
  return {
    spreadsheetId: runtimeConfig.googleSheetId || process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    sheetName: normalizeGoogleSheetName(runtimeConfig.googleSheetName) ||
      normalizeGoogleSheetName(process.env.GOOGLE_SHEETS_SHEET_NAME) ||
      DEFAULT_SHEET_NAME
  };
}

function isMojibakeGoogleSheetName(value) {
  const text = String(value || '');
  return /\uFFFD|\uFFFD\uFFFD\uFFFD|\u951f\u65a4\u62f7|\u6d60\uff46\u5abf|\u6d60\uff46\u5abf\u741b|\u9480\u82a5\u6e71|\u9422\u3126\u57db|\u935f\u55d7\u6427/.test(text);
}

function normalizeGoogleSheetName(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  return isMojibakeGoogleSheetName(text) ? '' : text;
}

function getGoogleSheetsCredentialPath() {
  const value = String(runtimeConfig.googleCredentialPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
  return value ? path.resolve(value) : '';
}

function extractSpreadsheetId(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\/spreadsheets\/d\/([^/]+)/);
  return (match ? match[1] : text).trim();
}

function applyGoogleSheetsConfig(config = {}) {
  const nextSheetId = extractSpreadsheetId(config.googleSheetId || config.spreadsheetId || config.googleSheetUrl || '');
  const nextCredentialPath = String(config.googleCredentialPath || config.credentialPath || '').trim();
  const nextSheetName = String(config.googleSheetName || config.sheetName || '').trim();
  const credentialChanged = nextCredentialPath !== runtimeConfig.googleCredentialPath;
  runtimeConfig = {
    googleSheetId: nextSheetId,
    googleCredentialPath: nextCredentialPath,
    googleSheetName: normalizeGoogleSheetName(nextSheetName)
  };
  if (credentialChanged) cachedToken = null;
  return { ...runtimeConfig };
}

async function applyGoogleSheetsConfigFromDb(database) {
  if (!database?.getAll) return { ...runtimeConfig };
  const rows = await database.getAll(
    "SELECT key, value FROM config WHERE key IN ('google_sheets_spreadsheet_id', 'google_application_credentials', 'google_sheets_sheet_name')"
  );
  const values = Object.fromEntries((rows || []).map(row => [row.key, row.value]));
  return applyGoogleSheetsConfig({
    googleSheetId: values.google_sheets_spreadsheet_id || '',
    googleCredentialPath: values.google_application_credentials || '',
    googleSheetName: values.google_sheets_sheet_name || ''
  });
}

function readServiceAccount() {
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON);
  }
  const credentialPath = getGoogleSheetsCredentialPath();
  if (credentialPath) {
    return JSON.parse(fs.readFileSync(credentialPath, 'utf8'));
  }
  if (process.env.GOOGLE_SHEETS_CLIENT_EMAIL && process.env.GOOGLE_SHEETS_PRIVATE_KEY) {
    return {
      client_email: process.env.GOOGLE_SHEETS_CLIENT_EMAIL,
      private_key: process.env.GOOGLE_SHEETS_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
  }
  return null;
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60000) return cachedToken.token;
  const account = readServiceAccount();
  if (!account?.client_email || !account?.private_key) {
    throw new Error('Google Sheets service account is not configured');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: account.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now
  };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`;
  const signature = crypto
    .createSign('RSA-SHA256')
    .update(unsigned)
    .sign(account.private_key);
  const assertion = `${unsigned}.${base64Url(signature)}`;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error(`Google token request failed: ${json.error_description || json.error || response.status}`);
  }
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (Number(json.expires_in || 3600) * 1000)
  };
  return cachedToken.token;
}

async function googleRequest(path, options = {}) {
  const token = await getAccessToken();
  const response = await fetch(`${SHEETS_API}/${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google Sheets request failed: ${json.error?.message || response.status}`);
  }
  return json;
}

async function getSheetId(spreadsheetId, sheetName) {
  const data = await googleRequest(`${spreadsheetId}?fields=sheets.properties`);
  const sheet = (data.sheets || []).find(item => item.properties?.title === sheetName);
  if (!sheet) throw new Error(`Google sheet tab not found: ${sheetName}`);
  return sheet.properties.sheetId;
}

function toColumnLetters(index) {
  let value = Number(index || 0);
  let letters = '';
  while (value >= 0) {
    letters = String.fromCharCode((value % 26) + 65) + letters;
    value = Math.floor(value / 26) - 1;
  }
  return letters;
}

function buildAppendRowsFormatRequest({ sheetId, startRowIndex, endRowIndex, backgroundColor = null }) {
  const userEnteredFormat = {
    backgroundColor: backgroundColor || DEFAULT_APPEND_BACKGROUND_COLOR,
    textFormat: {
      foregroundColor: DEFAULT_APPEND_TEXT_COLOR
    }
  };
  const fields = [
    'userEnteredFormat.backgroundColor',
    'userEnteredFormat.textFormat.foregroundColor'
  ];
  return {
    repeatCell: {
      range: {
        sheetId,
        startRowIndex,
        endRowIndex,
        startColumnIndex: 0,
        endColumnIndex: 10
      },
      cell: {
        userEnteredFormat
      },
      fields: fields.join(',')
    }
  };
}

async function appendRows({ rows, backgroundColor = null }) {
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured' };
  if (!Array.isArray(rows) || !rows.length) return { skipped: true, reason: 'no rows' };
  const { spreadsheetId, sheetName } = getSheetConfig();
  await ensureHeaderRow(spreadsheetId, sheetName);
  await applySheetBaseStyle(spreadsheetId, sheetName).catch(error => {
    console.warn('[Google Sheets] apply style skipped:', error.message || error);
  });
  const appendResult = await googleRequest(
    `${spreadsheetId}/values/${encodeURIComponent(`${sheetName}!A:J`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS&includeValuesInResponse=false`,
    {
      method: 'POST',
      body: JSON.stringify({ values: rows })
    }
  );
  if (rows.length) {
    const updatedRange = appendResult.updates?.updatedRange || '';
    const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
    if (match) {
      const startRowIndex = Number(match[1]) - 1;
      const endRowIndex = Number(match[2]);
      const sheetId = await getSheetId(spreadsheetId, sheetName);
      await googleRequest(`${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: [buildAppendRowsFormatRequest({ sheetId, startRowIndex, endRowIndex, backgroundColor })]
        })
      });
    }
  }
  return {
    skipped: false,
    updatedRange: appendResult.updates?.updatedRange || '',
    appendedRows: rows.length,
    lastColumn: toColumnLetters(9)
  };
}

function normalizeHexColor(value) {
  const text = String(value || '').trim().toLowerCase();
  const hex = text.startsWith('#') ? text : `#${text}`;
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : '';
}

function googleColorToHex(color = {}) {
  if (!color || typeof color !== 'object') return '';
  const toByte = value => {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number)) return 0;
    return Math.max(0, Math.min(255, Math.round(number * 255)));
  };
  const red = toByte(color.red).toString(16).padStart(2, '0');
  const green = toByte(color.green).toString(16).padStart(2, '0');
  const blue = toByte(color.blue).toString(16).padStart(2, '0');
  return `#${red}${green}${blue}`;
}

function extractCellText(cell = {}) {
  if (cell.formattedValue !== undefined) return String(cell.formattedValue || '');
  const value = cell.userEnteredValue || cell.effectiveValue || {};
  return String(value.stringValue ?? value.numberValue ?? value.formulaValue ?? value.boolValue ?? '');
}

function rowMatchesProductId(rowData = {}, productId = '') {
  const target = String(productId || '').trim().toLowerCase();
  if (!target) return false;
  const cells = Array.isArray(rowData.values) ? rowData.values.slice(0, 10) : [];
  return cells.some(cell => String(extractCellText(cell)).toLowerCase().includes(target));
}

function rowMatchesAnyBackgroundColor(rowData = {}, targetHex = '') {
  const normalizedTarget = normalizeHexColor(targetHex);
  if (!normalizedTarget) return false;
  const cells = Array.isArray(rowData.values) ? rowData.values.slice(0, 10) : [];
  return cells.some(cell => {
    const color = cell.userEnteredFormat?.backgroundColor || cell.effectiveFormat?.backgroundColor;
    return googleColorToHex(color) === normalizedTarget;
  });
}

async function findRowsByProductIdWithAnyColor(productId, targetHex) {
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured', matched: false, rows: [] };
  const { spreadsheetId, sheetName } = getSheetConfig();
  const range = `${sheetName}!A:J`;
  const data = await googleRequest(
    `${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=sheets(data(startRow,rowData(values(formattedValue,userEnteredValue,effectiveValue,userEnteredFormat/backgroundColor,effectiveFormat/backgroundColor))))`
  );
  const matches = [];
  for (const sheet of data.sheets || []) {
    for (const grid of sheet.data || []) {
      const startRow = Number(grid.startRow || 0);
      const rows = Array.isArray(grid.rowData) ? grid.rowData : [];
      rows.forEach((rowData, index) => {
        if (!rowMatchesProductId(rowData, productId)) return;
        if (!rowMatchesAnyBackgroundColor(rowData, targetHex)) return;
        matches.push({ rowNumber: startRow + index + 1 });
      });
    }
  }
  return { matched: matches.length > 0, rows: matches };
}

async function findRowsByProductId(productId) {
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured', matched: false, rows: [] };
  const { spreadsheetId, sheetName } = getSheetConfig();
  const range = `${sheetName}!A:J`;
  const data = await googleRequest(
    `${spreadsheetId}?includeGridData=true&ranges=${encodeURIComponent(range)}&fields=sheets(data(startRow,rowData(values(formattedValue,userEnteredValue,effectiveValue))))`
  );
  const matches = [];
  for (const sheet of data.sheets || []) {
    for (const grid of sheet.data || []) {
      const startRow = Number(grid.startRow || 0);
      const rows = Array.isArray(grid.rowData) ? grid.rowData : [];
      rows.forEach((rowData, index) => {
        if (!rowMatchesProductId(rowData, productId)) return;
        matches.push({ rowNumber: startRow + index + 1 });
      });
    }
  }
  return { matched: matches.length > 0, rows: matches };
}

async function updateRowsByProductId(productId, row) {
  if (!isGoogleSheetsConfigured()) return { skipped: true, reason: 'google sheets not configured', updatedRows: 0 };
  if (!productId) return { skipped: true, reason: 'missing product id', updatedRows: 0 };
  if (!Array.isArray(row) || !row.length) return { skipped: true, reason: 'missing row data', updatedRows: 0 };
  const { spreadsheetId, sheetName } = getSheetConfig();
  const found = await findRowsByProductId(productId);
  if (found.skipped) return { ...found, updatedRows: 0 };
  if (!found.rows.length) return { skipped: true, reason: 'google sheet row not found', matched: false, updatedRows: 0 };
  const values = row.slice(0, 10);
  while (values.length < 10) values.push('');
  const data = found.rows.map(match => ({
    range: `${sheetName}!A${match.rowNumber}:J${match.rowNumber}`,
    values: [values]
  }));
  await googleRequest(`${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'USER_ENTERED',
      data
    })
  });
  return {
    skipped: false,
    matched: true,
    updatedRows: data.length,
    rows: found.rows
  };
}

async function ensureHeaderRow(spreadsheetId, sheetName) {
  const range = encodeURIComponent(`${sheetName}!A1:J1`);
  const data = await googleRequest(`${spreadsheetId}/values/${range}?majorDimension=ROWS`);
  const firstRow = data.values?.[0] || [];
  const hasAnyHeader = firstRow.some(value => String(value || '').trim());
  const headerMatches = DEFAULT_HEADERS.every((header, index) => String(firstRow[index] || '').trim() === header);
  if (hasAnyHeader && headerMatches) return { updated: false };
  await googleRequest(`${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: JSON.stringify({ values: [DEFAULT_HEADERS] })
  });
  return { updated: true };
}

async function applySheetBaseStyle(spreadsheetId, sheetName) {
  const sheetId = await getSheetId(spreadsheetId, sheetName);
  const columnWidthRequests = DEFAULT_COLUMN_WIDTHS.map((pixelSize, index) => ({
    updateDimensionProperties: {
      range: {
        sheetId,
        dimension: 'COLUMNS',
        startIndex: index,
        endIndex: index + 1
      },
      properties: { pixelSize },
      fields: 'pixelSize'
    }
  }));
  await googleRequest(`${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1
              }
            },
            fields: 'gridProperties.frozenRowCount'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.90, green: 0.94, blue: 0.99 },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'WRAP',
                textFormat: {
                  foregroundColor: { red: 0.08, green: 0.13, blue: 0.20 },
                  fontSize: 10,
                  bold: true
                }
              }
            },
            fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,verticalAlignment,wrapStrategy,textFormat)'
          }
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 10
            },
            cell: {
              userEnteredFormat: {
                verticalAlignment: 'MIDDLE',
                wrapStrategy: 'CLIP',
                textFormat: {
                  fontSize: 10
                }
              }
            },
            fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat.fontSize)'
          }
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 0,
              endIndex: 1
            },
            properties: {
              pixelSize: 34
            },
            fields: 'pixelSize'
          }
        },
        ...columnWidthRequests
      ]
    })
  });
}

module.exports = {
  appendRows,
  applyGoogleSheetsConfig,
  applyGoogleSheetsConfigFromDb,
  applySheetBaseStyle,
  buildAppendRowsFormatRequest,
  ensureHeaderRow,
  extractSpreadsheetId,
  findRowsByProductId,
  findRowsByProductIdWithAnyColor,
  getGoogleSheetsCredentialPath,
  getSheetConfig,
  googleColorToHex,
  isGoogleSheetsConfigured,
  normalizeGoogleSheetName,
  updateRowsByProductId
};
