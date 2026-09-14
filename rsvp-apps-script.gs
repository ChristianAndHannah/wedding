var INVITE_CACHE_KEY = "rsvp_invites_v1";
var INVITE_CACHE_SECONDS = 30;
var RSVP_LOOKUP_SHEET = "rsvp_lookup";
var VERBOSE_TIMING_LOGS = true;

function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function splitMemberNames(value) {
  return String(value || "").split(/[|\n\r,;]+/).map(function (name) {
    return String(name).trim();
  }).filter(function (name) {
    return name.length > 0;
  });
}

function jsonError(message) {
  return ContentService.createTextOutput(JSON.stringify({
    result: "error",
    message: message
  })).setMimeType(ContentService.MimeType.JSON);
}

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function createRequestId() {
  return new Date().getTime().toString(36) + "-" + Math.floor(Math.random() * 1000000).toString(36);
}

function logTiming(requestId, label, startedAt, requestStartedAt) {
  if (!VERBOSE_TIMING_LOGS && label !== "total") return;
  var now = new Date().getTime();
  Logger.log(JSON.stringify({
    requestId: requestId,
    event: label,
    durationMs: now - startedAt,
    totalMs: now - requestStartedAt
  }));
}

function logRequest(requestId, event, details) {
  Logger.log(JSON.stringify({
    requestId: requestId,
    event: event,
    details: details || ""
  }));
}

function getRsvpNotificationRecipient() {
  var configuredRecipient = PropertiesService.getScriptProperties().getProperty("RSVP_NOTIFICATION_EMAIL");
  if (configuredRecipient) return configuredRecipient.trim();

  var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
  if (owner && owner.getEmail()) return owner.getEmail();

  return Session.getEffectiveUser().getEmail();
}

function sendRsvpNotification(parameters, requestId, requestStartedAt) {
  var recipient = getRsvpNotificationRecipient();
  if (!recipient) {
    logRequest(requestId, "email skipped", "The effective user has no email address.");
    return;
  }

  var emailStartedAt = new Date().getTime();
  var subject = "Wedding RSVP: " + parameters.name;
  var body = [
    "A wedding RSVP was submitted.",
    "",
    "Name: " + parameters.name,
    "Phone: " + parameters.phone,
    "Family: " + parameters.family_name,
    "Family ID: " + parameters.family_id,
    "Attending: " + (parameters.attending_members || "None"),
    "Not attending: " + (parameters.not_attending_members || "None"),
    "RSVP count: " + parameters.rsvp_count,
    "Status: " + parameters.status,
    "Notes: " + (parameters.notes || "None")
  ].join("\n");

  MailApp.sendEmail(recipient, subject, body);
  logTiming(requestId, "notification email", emailStartedAt, requestStartedAt);
}

function testRsvpEmail() {
  var recipient = getRsvpNotificationRecipient();
  if (!recipient) throw new Error("No notification recipient was found.");

  MailApp.sendEmail(
    recipient,
    "RSVP email test",
    "This is a test email from the wedding RSVP Apps Script."
  );
  Logger.log("RSVP test email sent to " + recipient);
}

function sheetHeaders(sheet) {
  return sheet.getDataRange().getValues()[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
}

function buildFamilyMap() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("invites");
  if (!sheet) throw new Error("The invites sheet is missing.");

  var values = sheet.getDataRange().getValues();
  if (!values.length) return {};
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  var nameIndex = headers.indexOf("family_name");
  var membersIndex = headers.indexOf("members");
  if (membersIndex < 0) membersIndex = headers.indexOf("member");
  var statusIndex = headers.indexOf("status");
  if (idIndex < 0 || nameIndex < 0 || membersIndex < 0) {
    throw new Error("Invite sheet columns are not configured correctly.");
  }

  var families = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    var familyId = String(row[idIndex] || "").trim();
    if (!familyId) continue;
    if (!families[familyId]) {
      families[familyId] = { familyId: familyId, familyName: "", members: [], status: "pending" };
    }
    families[familyId].familyName = String(row[nameIndex] || families[familyId].familyName).trim();
    if (statusIndex >= 0 && row[statusIndex]) {
      families[familyId].status = String(row[statusIndex]).trim() === "not_attending" ? "declined" : String(row[statusIndex]).trim();
    }
    splitMemberNames(row[membersIndex]).forEach(function (member) {
      var exists = families[familyId].members.some(function (existing) {
        return normalizeName(existing) === normalizeName(member);
      });
      if (!exists) families[familyId].members.push(member);
    });
  }
  return families;
}

function responseRecords() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("responses");
  if (!sheet) throw new Error("The responses sheet is missing.");
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  var records = {};
  for (var i = 1; i < values.length; i++) {
    var familyId = idIndex >= 0 ? String(values[i][idIndex] || "").trim() : "";
    if (!familyId) continue;
    records[familyId] = {};
    headers.forEach(function (header, index) {
      records[familyId][header] = values[i][index];
    });
  }
  return records;
}

function lookupRows() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_LOOKUP_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return null;

  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var required = ["family_id", "family_name", "members"];
  if (required.some(function (header) { return headers.indexOf(header) < 0; })) return null;

  return values.slice(1).map(function (row) {
    var record = {};
    headers.forEach(function (header, index) {
      record[header] = row[index];
    });
    var status = String(record.status || "pending").toLowerCase();
    return {
      familyId: String(record.family_id || "").trim(),
      familyName: String(record.family_name || "").trim(),
      members: splitMemberNames(record.members),
      status: status === "not_attending" ? "declined" : status,
      submittedBy: String(record.submitted_by || "").trim(),
      attending_members: String(record.attending_members || ""),
      not_attending_members: String(record.not_attending_members || ""),
      cannot_attend: status === "declined" ? "1" : "0",
      notes: String(record.notes || "")
    };
  }).filter(function (row) {
    return row.familyId;
  });
}

function cachedLookupRows() {
  var cached = CacheService.getScriptCache().get(INVITE_CACHE_KEY);
  if (!cached) return null;

  try {
    var payload = JSON.parse(cached);
    return payload && Array.isArray(payload.data) ? payload.data : null;
  } catch (error) {
    return null;
  }
}

function refreshRsvpLookup() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(RSVP_LOOKUP_SHEET) || spreadsheet.insertSheet(RSVP_LOOKUP_SHEET);
  var families = buildFamilyMap();
  var records = responseRecords();
  var rows = Object.keys(families).map(function (familyId) {
    var family = families[familyId];
    var response = records[familyId] || {};
    return [
      family.familyId,
      family.familyName,
      family.members.join("|"),
      response.status || family.status || "pending",
      response.submitted_by || "",
      response.attending_members || "",
      response.not_attending_members || "",
      response.notes || ""
    ];
  });
  var headers = ["family_id", "family_name", "members", "status", "submitted_by", "attending_members", "not_attending_members", "notes"];
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  CacheService.getScriptCache().remove(INVITE_CACHE_KEY);
  return rows.length;
}

function populateInvitesSheet() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = spreadsheet.getSheetByName(RSVP_LOOKUP_SHEET);
  if (!sourceSheet || sourceSheet.getLastRow() < 2) {
    throw new Error("The rsvp_lookup sheet has no family data.");
  }

  var sourceRows = lookupRows();
  if (!sourceRows || !sourceRows.length) {
    throw new Error("The rsvp_lookup sheet has no valid family data.");
  }

  var rows = [];
  sourceRows.forEach(function (family) {
    var attending = {};
    var notAttending = {};
    splitMemberNames(family.attending_members).forEach(function (member) {
      attending[normalizeName(member)] = true;
    });
    splitMemberNames(family.not_attending_members).forEach(function (member) {
      notAttending[normalizeName(member)] = true;
    });

    family.members.forEach(function (member) {
      var memberKey = normalizeName(member);
      var status = "pending";
      if (family.status === "declined" || family.status === "not_attending" || notAttending[memberKey]) {
        status = "not_attending";
      } else if (attending[memberKey]) {
        status = "attending";
      }
      rows.push([family.familyId, family.familyName, member, status]);
    });
  });

  var sheet = spreadsheet.getSheetByName("invites") || spreadsheet.insertSheet("invites");
  var headers = ["family_id", "family_name", "member", "status"];
  sheet.clear();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
    var colors = rows.map(function (row) {
      var color = "#fff2cc";
      if (row[3] === "attending") color = "#d9ead3";
      if (row[3] === "not_attending") color = "#f4cccc";
      return [color, color, color, color];
    });
    sheet.getRange(2, 1, rows.length, headers.length).setBackgrounds(colors);
  }

  sheet.autoResizeColumns(1, headers.length);
  CacheService.getScriptCache().remove(INVITE_CACHE_KEY);
  return rows.length;
}

function updateRsvpLookup(parameters) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RSVP_LOOKUP_SHEET);
  if (!sheet || sheet.getLastRow() < 1) return;

  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  if (idIndex < 0) return;

  var row = headers.map(function (header) {
    var valuesByHeader = {
      family_id: parameters.family_id,
      family_name: parameters.family_name,
      members: parameters.family_members,
      status: parameters.status,
      submitted_by: parameters.name,
      attending_members: parameters.attending_members,
      not_attending_members: parameters.not_attending_members,
      notes: parameters.notes
    };
    return valuesByHeader[header] === undefined ? "" : valuesByHeader[header];
  });
  var rowNumber = -1;
  if (lastRow > 1) {
    var idValues = sheet.getRange(2, idIndex + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0] || "").trim() === parameters.family_id) {
        rowNumber = i + 2;
        break;
      }
    }
  }
  if (rowNumber < 0) sheet.appendRow(row);
  else sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function findFamilyForSubmission(familyId) {
  var rows = lookupRows();
  if (rows) {
    return rows.filter(function (family) {
      return family.familyId === familyId;
    })[0] || null;
  }
  return buildFamilyMap()[familyId] || null;
}

function doGet(e) {
  try {
    if (!e || !e.parameter) return jsonError("Unknown action.");

    if (e.parameter.action === "ping") {
      return jsonResponse({ result: "success" });
    }

    if (e.parameter.action === "findFamily") {
      var requestedName = normalizeName(e.parameter.name);
      if (!requestedName) return jsonError("Please enter your full name.");

      var lookupData = cachedLookupRows() || lookupRows();
      if (lookupData) {
        var matchingFamily = lookupData.filter(function (family) {
          return family.members.some(function (member) {
            return normalizeName(member) === requestedName;
          });
        })[0];
        return jsonResponse({ result: "success", data: matchingFamily || null });
      }

      var familyMap = buildFamilyMap();
      var familyIds = Object.keys(familyMap);
      for (var familyIndex = 0; familyIndex < familyIds.length; familyIndex++) {
        var candidate = familyMap[familyIds[familyIndex]];
        if (candidate.members.some(function (member) {
          return normalizeName(member) === requestedName;
        })) {
          return jsonResponse({
            result: "success",
            data: {
              familyId: candidate.familyId,
              familyName: candidate.familyName,
              members: candidate.members,
              status: candidate.status,
              submittedBy: "",
              attending_members: "",
              not_attending_members: "",
              cannot_attend: candidate.status === "declined" ? "1" : "0",
              notes: ""
            }
          });
        }
      }
      return jsonResponse({ result: "success", data: null });
    }

    if (e.parameter.action !== "getInvites") return jsonError("Unknown action.");
    var cache = CacheService.getScriptCache();
    var cached = cache.get(INVITE_CACHE_KEY);
    if (cached) return ContentService.createTextOutput(cached).setMimeType(ContentService.MimeType.JSON);

    var data = lookupRows();
    if (!data) {
      var families = buildFamilyMap();
      var records = responseRecords();
      data = Object.keys(families).map(function (familyId) {
        var family = families[familyId];
        var response = records[familyId] || {};
        var responseStatus = String(response.status || family.status || "pending").toLowerCase();
        return {
          familyId: family.familyId,
          familyName: family.familyName,
          members: family.members,
          status: responseStatus === "declined" || responseStatus === "not_attending" ? "declined" : responseStatus,
          submittedBy: String(response.submitted_by || "").trim(),
          attending_members: String(response.attending_members || ""),
          not_attending_members: String(response.not_attending_members || ""),
          cannot_attend: responseStatus === "declined" ? "1" : "0",
          notes: String(response.notes || "")
        };
      });
    }
    var payload = JSON.stringify({ result: "success", data: data });
    cache.put(INVITE_CACHE_KEY, payload, INVITE_CACHE_SECONDS);
    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log(error);
    return jsonError("Could not load invites.");
  }
}

function upsertResponse(parameters, requestId, requestStartedAt) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("responses");
  if (!sheet) throw new Error("The responses sheet is missing.");
  var readStartedAt = new Date().getTime();
  var values = sheet.getDataRange().getValues();
  if (requestId) logTiming(requestId, "responses read", readStartedAt, requestStartedAt);
  var searchStartedAt = new Date().getTime();
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  var rowNumber = -1;
  for (var i = 1; i < values.length; i++) {
    if (idIndex >= 0 && String(values[i][idIndex] || "").trim() === parameters.family_id) {
      rowNumber = i + 1;
      break;
    }
  }
  if (requestId) logTiming(requestId, "responses row search", searchStartedAt, requestStartedAt);

  var record = {
    timestamp: new Date(),
    phone: parameters.phone || "",
    name: parameters.name || "",
    family_id: parameters.family_id || "",
    family_name: parameters.family_name || "",
    family_members: parameters.family_members || "",
    attending_members: parameters.attending_members || "",
    not_attending_members: parameters.not_attending_members || "",
    rsvp_count: parameters.rsvp_count || "",
    submitted_by: parameters.name || "",
    status: parameters.status || "confirmed",
    notes: parameters.notes || ""
  };
  var row = headers.map(function (header) {
    return record[header] === undefined ? "" : record[header];
  });
  var writeStartedAt = new Date().getTime();
  if (rowNumber < 0) sheet.appendRow(row);
  else sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
  if (requestId) logTiming(requestId, rowNumber < 0 ? "responses append" : "responses update", writeStartedAt, requestStartedAt);
}

function updateInviteStatus(familyId, guestName, attendingMembers, cannotAttend, notes) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("invites");
  if (!sheet) throw new Error("The invites sheet is missing.");
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  var membersIndex = headers.indexOf("members");
  if (membersIndex < 0) membersIndex = headers.indexOf("member");
  var statusIndex = headers.indexOf("status");
  var submittedByIndex = headers.indexOf("submitted_by");
  var notesIndex = headers.indexOf("notes");
  if (idIndex < 0 || membersIndex < 0 || statusIndex < 0) {
    throw new Error("Invite sheet columns are not configured correctly.");
  }
  attendingMembers = Array.isArray(attendingMembers) ? attendingMembers : splitMemberNames(attendingMembers || "");
  var attending = {};
  attendingMembers.forEach(function (member) { attending[normalizeName(member)] = true; });

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][idIndex] || "").trim() !== familyId) continue;
    var status = "not_attending";
    splitMemberNames(values[i][membersIndex]).forEach(function (member) {
      if (attending[normalizeName(member)]) status = "attending";
    });
    values[i][statusIndex] = status;
    if (submittedByIndex >= 0) values[i][submittedByIndex] = guestName;
    if (notesIndex >= 0) values[i][notesIndex] = notes;
  }

  for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
    if (String(values[rowIndex][idIndex] || "").trim() === familyId) {
      sheet.getRange(rowIndex + 1, 1, 1, values[rowIndex].length)
        .setValues([values[rowIndex]]);
    }
  }
}

function doPost(e) {
  var requestStartedAt = new Date().getTime();
  var requestId = createRequestId();
  var lock = LockService.getScriptLock();
  var lockAcquired = false;
  var stage = "starting";
  var outcome = "failed";
  logRequest(requestId, "doPost started");
  try {
    stage = "acquiring RSVP lock";
    var lockStartedAt = new Date().getTime();
    lockAcquired = lock.tryLock(3000);
    logTiming(requestId, "lock", lockStartedAt, requestStartedAt);
    if (!lockAcquired) {
      outcome = "busy";
      logRequest(requestId, "doPost rejected", outcome);
      return jsonError("The RSVP service is busy. Please try again in a moment.");
    }
    stage = "validating RSVP";
    var params = e.parameters || {};
    var guestName = String(params.name || "").trim();
    var familyId = String(params.family_id || "").trim();
    var attendingMembers = splitMemberNames(params.attending_members || "");
    var notAttendingMembers = splitMemberNames(params.not_attending_members || "");
    var cannotAttend = String(params.cannot_attend || "0") === "1" || attendingMembers.length === 0;
    var rsvpCount = parseInt(params.rsvp_count || 0, 10);
    var lookupData = cachedLookupRows() || lookupRows();
    var family = lookupData ? lookupData.filter(function (candidate) {
      return candidate.familyId === familyId;
    })[0] : buildFamilyMap()[familyId];
    if (!guestName || !family) {
      outcome = "invalid-family";
      return jsonError("Missing or invalid family information.");
    }
    if (!family.members.some(function (member) { return normalizeName(member) === normalizeName(guestName); })) {
      outcome = "invalid-guest";
      return jsonError("That name does not belong to this family invite.");
    }
    if (!cannotAttend && (!rsvpCount || rsvpCount > family.members.length)) {
      outcome = "invalid-count";
      return jsonError("Please select a valid number of attendees.");
    }
    logTiming(requestId, "validation", requestStartedAt, requestStartedAt);

    var parameters = {
      phone: String(params.phone || "").trim(),
      name: guestName,
      family_id: familyId,
      family_name: String(params.family_name || family.familyName).trim(),
      family_members: family.members.join("|"),
      attending_members: attendingMembers.join("|"),
      not_attending_members: notAttendingMembers.join("|"),
      rsvp_count: cannotAttend ? "0" : String(rsvpCount),
      status: cannotAttend ? "declined" : "confirmed",
      notes: String(params.notes || "").trim()
    };
    stage = "saving RSVP response";
    var responseWriteStartedAt = new Date().getTime();
    upsertResponse(parameters, requestId, requestStartedAt);
    logTiming(requestId, "responses write", responseWriteStartedAt, requestStartedAt);

    try {
      stage = "updating RSVP lookup";
      updateRsvpLookup(parameters);
      logRequest(requestId, "lookup updated");
    } catch (lookupError) {
      logRequest(requestId, "non-critical failure", "lookup update: " + lookupError);
    }

    try {
      stage = "sending RSVP notification";
      sendRsvpNotification(parameters, requestId, requestStartedAt);
    } catch (emailError) {
      logRequest(requestId, "non-critical failure", "notification email: " + emailError);
    }

    outcome = "success";
    logRequest(requestId, "doPost completed", "response, lookup, and notification processing finished");
    return jsonResponse({ result: "success", data: parameters });
  } catch (error) {
    logRequest(requestId, "doPost failed", stage + ": " + (error.stack || error));
    return jsonError("Could not save the RSVP while " + stage + ". Please try again.");
  } finally {
    logRequest(requestId, "doPost finished", outcome + "; lockAcquired=" + lockAcquired);
    logTiming(requestId, "total", requestStartedAt, requestStartedAt);
    if (lockAcquired && lock.hasLock()) lock.releaseLock();
  }
}

