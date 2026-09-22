/**
 * WorkSphere / Brightstar Bid Tracking — Apps Script web app.
 *
 * Deploy: Extensions → Apps Script → paste this file → Deploy → New deployment → Web app
 *   Execute as: Me
 *   Who has access: Anyone
 * Paste the Web App URL into WorkSphere → Job Hunting → Bid tracking → Google Sheet (bid bot).
 *
 * POST body (text/plain JSON):
 *   action: "listLinks" | "listRows" | "append" | "markApplied"
 *   spreadsheetId (required)
 *   optional sheetName / tabName (profile tab, e.g. "Lewis-SF")
 *   for append / markApplied: jobNo, applicationDate, jobTitle, companyName, jobLink, salary, status
 *
 * Expected columns (headers matched flexibly; missing columns are skipped, not errors):
 *   No | Created Date | Title | Company | Link | Salary | Apply Status
 *
 * Unknown actions return { ok:false } — they never fall through to append.
 */

function doPost(e) {
  try {
    var data = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (!data.spreadsheetId) {
      throw new Error("spreadsheetId is required.");
    }

    var ss = SpreadsheetApp.openById(String(data.spreadsheetId));
    var action = String(data.action || "").trim().toLowerCase();
    var createTab =
      action === "append" ||
      action === "markapplied" ||
      action === "mark_applied" ||
      action === "applied";
    var sheet = resolveSheet_(ss, data.sheetName || data.tabName || "", createTab);

    if (action === "listrows" || action === "list_rows" || action === "rows") {
      return json_({
        ok: true,
        supportsListRows: true,
        capabilities: ["listLinks", "listRows", "append", "markApplied"],
        rows: listRows_(sheet),
      });
    }

    if (action === "listlinks" || action === "list_links" || action === "links") {
      var listed = listLinks_(sheet);
      return json_({
        ok: true,
        supportsListRows: true,
        capabilities: ["listLinks", "listRows", "append", "markApplied"],
        linkStatuses: listed.linkStatuses,
        companyRows: listed.companyRows,
        rows: listed.rows,
      });
    }

    if (action === "markapplied" || action === "mark_applied" || action === "applied") {
      return json_(markApplied_(sheet, data));
    }

    if (action === "append" || action === "") {
      return json_(appendRow_(sheet, data));
    }

    return json_({
      ok: false,
      error: 'Unknown action "' + action + '". Use listLinks, listRows, append, or markApplied.',
    });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return json_({
    ok: true,
    supportsListRows: true,
    capabilities: ["listLinks", "listRows", "append", "markApplied"],
  });
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function resolveSheet_(ss, sheetName, createIfMissing) {
  var name = String(sheetName || "").trim();
  if (!name) return ss.getSheets()[0];
  var sheet = ss.getSheetByName(name);
  if (sheet) return sheet;
  if (createIfMissing) {
    sheet = ss.insertSheet(name);
    ensureHeaders_(sheet);
    return sheet;
  }
  throw new Error('Sheet tab "' + name + '" not found.');
}

function ensureHeaders_(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet
    .getRange(1, 1, 1, 7)
    .setValues([
      ["No", "Created Date", "Title", "Company", "Link", "Salary", "Apply Status"],
    ]);
}

function headerIndexMap_(headerRow) {
  var headers = (headerRow || []).map(function (h) {
    return String(h || "")
      .trim()
      .toLowerCase();
  });

  function find(names, fallback) {
    for (var i = 0; i < names.length; i++) {
      var idx = headers.indexOf(names[i]);
      if (idx >= 0) return idx;
    }
    return fallback;
  }

  return {
    jobNo: find(["no", "job no", "job #", "#", "id"], 0),
    date: find(
      ["created date", "date", "application date", "applied date", "created"],
      1
    ),
    title: find(["title", "job title", "role", "position"], 2),
    company: find(["company", "company name", "employer", "org"], 3),
    link: find(["link", "job link", "url", "jd", "jd link", "listing"], 4),
    salary: find(["salary", "pay", "compensation", "rate"], 5),
    status: find(["apply status", "status", "application status", "state"], 6),
  };
}

function cell_(row, idx) {
  if (idx == null || idx < 0 || idx >= row.length) return "";
  var v = row[idx];
  if (v instanceof Date) {
    return v.getMonth() + 1 + "/" + v.getDate() + "/" + v.getFullYear();
  }
  return String(v == null ? "" : v).trim();
}

function readSheetMatrix_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), 7);
  if (lastRow < 1) {
    ensureHeaders_(sheet);
    return { headers: [], rows: [], map: headerIndexMap_([]) };
  }
  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0] || [];
  var map = headerIndexMap_(headers);
  return { headers: headers, rows: values.slice(1), map: map };
}

function listRows_(sheet) {
  var data = readSheetMatrix_(sheet);
  var out = [];
  for (var i = 0; i < data.rows.length; i++) {
    var row = data.rows[i];
    var mapped = {
      row: i + 2,
      jobNo: cell_(row, data.map.jobNo),
      date: cell_(row, data.map.date),
      title: cell_(row, data.map.title),
      company: cell_(row, data.map.company),
      link: cell_(row, data.map.link),
      salary: cell_(row, data.map.salary),
      status: cell_(row, data.map.status),
    };
    if (!mapped.title && !mapped.company && !mapped.link && !mapped.salary) continue;
    out.push(mapped);
  }
  return out;
}

function listLinks_(sheet) {
  var rows = listRows_(sheet);
  return {
    rows: rows,
    linkStatuses: rows.map(function (r) {
      return {
        row: r.row,
        link: r.link,
        status: r.status,
        title: r.title,
        company: r.company,
        salary: r.salary,
        date: r.date,
      };
    }),
    companyRows: rows.map(function (r) {
      return { company: r.company, link: r.link, title: r.title };
    }),
  };
}

function normalizeLink_(url) {
  var raw = String(url || "").trim();
  if (!raw) return "";
  try {
    // Apps Script has no URL class — light normalize.
    return raw.replace(/\/+$/, "").toLowerCase();
  } catch (e) {
    return raw.toLowerCase();
  }
}

function findRowByLink_(sheet, jobLink) {
  var key = normalizeLink_(jobLink);
  if (!key) return -1;
  var data = readSheetMatrix_(sheet);
  for (var i = 0; i < data.rows.length; i++) {
    var link = normalizeLink_(cell_(data.rows[i], data.map.link));
    if (link && link === key) return i + 2;
  }
  return -1;
}

function appendRow_(sheet, data) {
  ensureHeaders_(sheet);
  var link = String(data.jobLink || data.link || "").trim();
  var existing = findRowByLink_(sheet, link);
  if (existing > 0 && link) {
    return { ok: true, duplicate: true, row: existing };
  }

  var header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 7)).getValues()[0];
  var map = headerIndexMap_(header);
  var width = Math.max(header.length, 7);
  var values = [];
  for (var c = 0; c < width; c++) values.push("");

  values[map.jobNo] = String(data.jobNo || "");
  values[map.date] = String(data.applicationDate || data.date || "");
  values[map.title] = String(data.jobTitle || data.title || "");
  values[map.company] = String(data.companyName || data.company || "");
  values[map.link] = link;
  values[map.salary] = String(data.salary || "");
  values[map.status] = String(data.status || "Ready");

  sheet.appendRow(values);
  return { ok: true, appended: true, duplicate: false, row: sheet.getLastRow() };
}

function markApplied_(sheet, data) {
  ensureHeaders_(sheet);
  var link = String(data.jobLink || data.link || "").trim();
  var status = String(data.status || "Applied");
  var rowNum = findRowByLink_(sheet, link);

  if (rowNum < 0) {
    var appended = appendRow_(sheet, data);
    rowNum = appended.row;
    if (appended.duplicate) {
      // Update status on the existing duplicate row.
    } else {
      // Just appended with status already set.
      return { ok: true, updated: true, row: rowNum };
    }
  }

  var header = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 7)).getValues()[0];
  var map = headerIndexMap_(header);
  sheet.getRange(rowNum, map.status + 1).setValue(status);
  if (data.jobTitle || data.title) {
    sheet.getRange(rowNum, map.title + 1).setValue(String(data.jobTitle || data.title || ""));
  }
  if (data.companyName || data.company) {
    sheet
      .getRange(rowNum, map.company + 1)
      .setValue(String(data.companyName || data.company || ""));
  }
  if (data.salary) {
    sheet.getRange(rowNum, map.salary + 1).setValue(String(data.salary || ""));
  }
  return { ok: true, updated: true, row: rowNum };
}
