const crypto = require('crypto');
const fs = require('fs');

const DEFAULT_SPREADSHEET_ID = '1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4';
const DEFAULT_SHEET_NAME = '-代拍表-';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_HEADERS = ['落札日期', '用户名', '商品链接', '商品标题', '落札价', '运费', '同捆运费', '总价', '物流', '单号'];
const DEFAULT_COLUMN_WIDTHS = [96, 110, 210, 360, 90, 100, 110, 90, 120, 150];

let cachedToken = null;

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
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.GOOGLE_SHEETS_CLIENT_EMAIL
  );
}

function getSheetConfig() {
  return {
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID,
    sheetName: process.env.GOOGLE_SHEETS_SHEET_NAME || DEFAULT_SHEET_NAME
  };
}

function readServiceAccount() {
  if (process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON);
  }
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
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
  if (backgroundColor && rows.length) {
    const updatedRange = appendResult.updates?.updatedRange || '';
    const match = updatedRange.match(/![A-Z]+(\d+):[A-Z]+(\d+)/);
    if (match) {
      const startRowIndex = Number(match[1]) - 1;
      const endRowIndex = Number(match[2]);
      const sheetId = await getSheetId(spreadsheetId, sheetName);
      await googleRequest(`${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: [{
            repeatCell: {
              range: {
                sheetId,
                startRowIndex,
                endRowIndex,
                startColumnIndex: 0,
                endColumnIndex: 10
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor
                }
              },
              fields: 'userEnteredFormat.backgroundColor'
            }
          }]
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
  applySheetBaseStyle,
  ensureHeaderRow,
  getSheetConfig,
  isGoogleSheetsConfigured
};
