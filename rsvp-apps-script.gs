var TO_ADDRESS = "christian.hannah.2027@gmail.com";

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

function doGet(e) {
  try {
    if (!e || !e.parameter || e.parameter.action !== "getInvites") return jsonError("Unknown action.");
    var families = buildFamilyMap();
    var records = responseRecords();
    var data = Object.keys(families).map(function (familyId) {
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
    return ContentService.createTextOutput(JSON.stringify({ result: "success", data: data }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log(error);
    return jsonError("Could not load invites.");
  }
}

function upsertResponse(parameters) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("responses");
  if (!sheet) throw new Error("The responses sheet is missing.");
  var values = sheet.getDataRange().getValues();
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
  if (rowNumber < 0) sheet.appendRow(row);
  else sheet.getRange(rowNumber, 1, 1, row.length).setValues([row]);
}

function updateInviteStatus(familyId, guestName, attendingMembers, cannotAttend, notes) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("invites");
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (header) {
    return String(header).trim().toLowerCase();
  });
  var idIndex = headers.indexOf("family_id");
  var membersIndex = headers.indexOf("members");
  var statusIndex = headers.indexOf("status");
  var submittedByIndex = headers.indexOf("submitted_by");
  var notesIndex = headers.indexOf("notes");
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

  if (values.length > 1) {
    sheet.getRange(2, 1, values.length - 1, values[0].length)
      .setValues(values.slice(1));
  }
}

function doPost(e) {
  try {
    var params = e.parameters || {};
    var guestName = String(params.name || "").trim();
    var familyId = String(params.family_id || "").trim();
    var attendingMembers = splitMemberNames(params.attending_members || "");
    var notAttendingMembers = splitMemberNames(params.not_attending_members || "");
    var cannotAttend = String(params.cannot_attend || "0") === "1" || attendingMembers.length === 0;
    var rsvpCount = parseInt(params.rsvp_count || 0, 10);
    var family = buildFamilyMap()[familyId];
    if (!guestName || !family) return jsonError("Missing or invalid family information.");
    if (!family.members.some(function (member) { return normalizeName(member) === normalizeName(guestName); })) {
      return jsonError("That name does not belong to this family invite.");
    }
    if (!cannotAttend && (!rsvpCount || rsvpCount > family.members.length)) {
      return jsonError("Please select a valid number of attendees.");
    }

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
    upsertResponse(parameters);
    updateInviteStatus(familyId, guestName, attendingMembers, cannotAttend, parameters.notes);

    MailApp.sendEmail({
      to: TO_ADDRESS,
      subject: "A family RSVP was updated",
      htmlBody: formatMailBody(parameters)
    });

    return ContentService.createTextOutput(JSON.stringify({ result: "success", data: parameters }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log(error);
    return jsonError("Sorry, there is an issue with the server.");
  }
}

function formatMailBody(obj) {
  var result = "";
  for (var key in obj) {
    result += "<h4 style='text-transform: capitalize; margin-bottom: 0'>" + key + "</h4><div>" + obj[key] + "</div>";
  }
  return result;
}