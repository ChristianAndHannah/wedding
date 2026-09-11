var RSVP_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxO9DjNFDCx6HcSSanoYuoLRNceFw0d9SmGWW2XISuTl4ENMQQlO7TKowyrgOsy19ImGw/exec';

var familyGroups = [];

function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, function (character) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[character];
    });
}

function splitMemberList(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value;
    }

    return String(value)
        .split(/[|\n\r,;]+/)
        .map(function (entry) {
            return String(entry || '').trim();
        })
        .filter(function (entry) {
            return !!entry;
        });
}

function dedupeNames(names) {
    var seen = {};
    return (names || []).filter(function (name) {
        var cleaned = String(name || '').trim();
        if (!cleaned) {
            return false;
        }

        var key = normalizeName(cleaned);
        if (seen[key]) {
            return false;
        }

        seen[key] = true;
        return true;
    });
}

function normalizeOneFamily(group) {
    if (!group) {
        return null;
    }

    var familyId = group.family_id || group.familyId || group['family_id'];
    var familyName = group.family_name || group.familyName || group['family_name'];
    var members = group.members || group.memberNames || group['members'];

    if (Array.isArray(members)) {
        members = members;
    } else {
        members = splitMemberList(members);
    }

    return {
        familyId: String(familyId || '').trim(),
        familyName: String(familyName || '').trim(),
        members: dedupeNames(members),
        status: String(group.status || group.rsvp_status || '').trim(),
        submittedBy: String(group.submitted_by || group.submittedBy || '').trim(),
        attendingMembers: dedupeNames(splitMemberList(group.attending_members || group.attendingMembers)),
        notAttendingMembers: dedupeNames(splitMemberList(group.not_attending_members || group.notAttendingMembers)),
        cannotAttend: String(group.cannot_attend || group.cannotAttend || '') === '1',
        notes: String(group.notes || '').trim()
    };
}

function normalizeFamilyGroups(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        return [];
    }

    if (rows[0] && (Array.isArray(rows[0].members) || rows[0].familyId || rows[0].family_id)) {
        var grouped = rows.map(function (group) {
            return normalizeOneFamily(group);
        }).filter(Boolean);

        return grouped.filter(function (group) {
            return group.familyId || group.familyName || group.members.length > 0;
        });
    }

    var byFamily = {};

    rows.forEach(function (row) {
        var familyId = row.family_id || row.familyId || row['family_id'];
        var familyName = row.family_name || row.familyName || row['family_name'];
        var memberValue = row.members || row.member || row.name || row.guest_name || row.member_name || row.memberName || row['member_name'] || row['members'];
        var members = splitMemberList(memberValue);
        var status = row.status || row.rsvp_status || row['status'];
        var submittedBy = row.submitted_by || row.submittedBy || row['submitted_by'];
        var familyKey = String(familyId || familyName || '').trim();

        if (!familyKey) {
            return;
        }

        if (!byFamily[familyKey]) {
            byFamily[familyKey] = {
                familyId: familyId || familyKey,
                familyName: familyName || familyKey,
                members: [],
                status: status || '',
                submittedBy: submittedBy || '',
                attendingMembers: [],
                notAttendingMembers: [],
                cannotAttend: false,
                notes: ''
            };
        }

        if (members.length > 0) {
            byFamily[familyKey].members = byFamily[familyKey].members.concat(members);
        }

        if (status) {
            byFamily[familyKey].status = status;
        }

        if (submittedBy) {
            byFamily[familyKey].submittedBy = submittedBy;
        }

        byFamily[familyKey].attendingMembers = dedupeNames(splitMemberList(row.attending_members || row.attendingMembers));
        byFamily[familyKey].notAttendingMembers = dedupeNames(splitMemberList(row.not_attending_members || row.notAttendingMembers));
        byFamily[familyKey].cannotAttend = String(row.cannot_attend || row.cannotAttend || '') === '1';
        byFamily[familyKey].notes = String(row.notes || '').trim();
    });

    return Object.keys(byFamily).map(function (familyKey) {
        var group = byFamily[familyKey];
        return {
            familyId: group.familyId,
            familyName: group.familyName,
            members: dedupeNames(group.members),
            status: group.status,
            submittedBy: group.submittedBy || '',
            attendingMembers: group.attendingMembers || [],
            notAttendingMembers: group.notAttendingMembers || [],
            cannotAttend: group.cannotAttend,
            notes: group.notes || ''
        };
    });
}

function matchesGuestName(memberName, inputName) {
    var member = normalizeName(memberName);
    var input = normalizeName(inputName);

    if (!member || !input) {
        return false;
    }

    return member === input;
}

function findFamilyByMemberName(name) {
    return familyGroups.find(function (group) {
        return (group.members || []).some(function (member) {
            return matchesGuestName(member, name);
        });
    });
}

function resetFamilyLookupState() {
    $('#family-status-row').hide();
    $('#existing-rsvp-status-text').empty();
    $('#family-selection-row').hide();
    $('#family-match').hide();
    $('#family-id').val('');
    $('#family-name').val('');
    $('#family-members-input').val('');
    $('#attending-members-input').val('');
    $('#not-attending-members-input').val('');
    $('#family-cannot-attend').val('0');
    $('#extras-input').val('0');
    $('#rsvp-notes').val('');
    $('#submit-rsvp-btn').prop('disabled', true).hide();
    $('#check-all-family-btn').removeClass('btn-accent').addClass('btn-default');
    $('#cannot-attend-btn').removeClass('btn-accent').addClass('btn-default');
    $('#family-members-list').empty();
}

function updateFamilySelectionState(family) {
    var familyMembers = family.members || [];
    var checkboxes = $('#family-members-list input[name="family-member-attending"]');
    var checkedNames = [];
    var cannotAttend = $('#family-cannot-attend').val() === '1';

    checkboxes.each(function () {
        if (this.checked) {
            checkedNames.push($(this).data('member'));
        }
    });

    $('#attending-members-input').val(checkedNames.join('|'));
    $('#not-attending-members-input').val(familyMembers.filter(function (member) {
        return checkedNames.indexOf(member) === -1;
    }).join('|'));

    if (cannotAttend) {
        $('#family-status-text').html(window.rsvpText('familyUnable'));
        $('#submit-rsvp-btn').prop('disabled', false);
        return;
    }

    if (checkedNames.length > 0) {
        $('#family-status-text').html(window.rsvpText('familyAttending'));
        $('#submit-rsvp-btn').prop('disabled', false);
    } else {
        $('#family-status-text').html(window.rsvpText('familySelect'));
        $('#submit-rsvp-btn').prop('disabled', true);
    }
}

function renderFamilyMatch(family) {
    var familyList = $('#family-members-list');
    var familyStatusText = $('#family-status-text');
    var existingRsvpStatusText = $('#existing-rsvp-status-text');
    var hasExistingRsvp = family.status === 'confirmed' || family.status === 'declined' || family.submittedBy;

    familyList.empty();
    $.each(family.members, function (index, member) {
        var isAttending = (family.attendingMembers || []).some(function (attendingMember) {
            return normalizeName(attendingMember) === normalizeName(member);
        });
        familyList.append('<li style="margin-bottom:8px; text-align:left;"><label style="font-weight:normal; margin-bottom:0;"><input type="checkbox" name="family-member-attending" data-member="' + member + '"' + (isAttending ? ' checked' : '') + ' /> ' + member + '</label></li>');
    });

    $('#family-id').val(family.familyId);
    $('#family-name').val(family.familyName);
    $('#family-members-input').val(family.members.join('|'));
    $('#family-cannot-attend').val(family.cannotAttend ? '1' : '0');
    $('#attending-members-input').val((family.attendingMembers || []).join('|'));
    $('#not-attending-members-input').val((family.notAttendingMembers || family.members).join('|'));
    $('#rsvp-notes').val(family.notes || '');
    $('#family-selection-row').show();
    $('#family-match').show();
    $('#submit-rsvp-btn')
    .show()
    .prop('disabled', true);
    $('#check-all-family-btn').removeClass('btn-accent').addClass('btn-default');
    $('#cannot-attend-btn').removeClass('btn-accent').addClass('btn-default');

    if (hasExistingRsvp) {
        $('#family-status-row').show();
        $('#cannot-attend-btn').toggleClass('btn-accent', family.cannotAttend).toggleClass('btn-default', !family.cannotAttend);
    } else {
        $('#family-status-row').hide();
        familyStatusText.html(window.rsvpText('familySelect'));
    }

    $('#family-members-list input').prop('disabled', false);
    updateFamilySelectionState(family);

    if (hasExistingRsvp) {
        var existingRsvpLines = [
            window.rsvpText('existingRsvpBy', {
                name: escapeHtml(family.submittedBy || 'another guest')
            })
        ];
        if (family.attendingMembers && family.attendingMembers.length) {
            existingRsvpLines.push(window.rsvpText('attendingSummary', {
                names: escapeHtml(family.attendingMembers.join(', '))
            }));
        }
        if (family.notAttendingMembers && family.notAttendingMembers.length) {
            existingRsvpLines.push(window.rsvpText('notAttendingSummary', {
                names: escapeHtml(family.notAttendingMembers.join(', '))
            }));
        }
        existingRsvpLines.push(window.rsvpText('editRsvp'));
        existingRsvpStatusText.html(existingRsvpLines.join('<br>'));
    }

    $('#family-members-list input[name="family-member-attending"]').on('change', function () {
        $('#family-cannot-attend').val('0');
        $('#cannot-attend-btn').removeClass('btn-accent').addClass('btn-default');
        updateFamilySelectionState(family);
    });
}

function loadFamilyGroups() {
    $.ajax({
        url: RSVP_SCRIPT_URL + '?action=getInvites',
        method: 'GET',
        dataType: 'json',
        success: function (response) {
            if (response && response.result === 'success' && Array.isArray(response.data)) {
                familyGroups = normalizeFamilyGroups(response.data);
                return;
            }
            familyGroups = [];
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> The invite list could not be loaded.'));
        },
        error: function () {
            familyGroups = [];
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> The invite list could not be loaded.'));
        }
    });
}

$(document).ready(function () {
    loadFamilyGroups();
    resetFamilyLookupState();

    /***************** Waypoints ******************/

    $('.wp1').waypoint(function () {
        $('.wp1').addClass('animated fadeInLeft');
    }, {
        offset: '75%'
    });
    $('.wp2').waypoint(function () {
        $('.wp2').addClass('animated fadeInRight');
    }, {
        offset: '75%'
    });
    $('.wp3').waypoint(function () {
        $('.wp3').addClass('animated fadeInLeft');
    }, {
        offset: '75%'
    });
    $('.wp4').waypoint(function () {
        $('.wp4').addClass('animated fadeInRight');
    }, {
        offset: '75%'
    });
    $('.wp5').waypoint(function () {
        $('.wp5').addClass('animated fadeInLeft');
    }, {
        offset: '75%'
    });
    $('.wp6').waypoint(function () {
        $('.wp6').addClass('animated fadeInRight');
    }, {
        offset: '75%'
    });
    $('.wp7').waypoint(function () {
        $('.wp7').addClass('animated fadeInUp');
    }, {
        offset: '75%'
    });
    $('.wp8').waypoint(function () {
        $('.wp8').addClass('animated fadeInLeft');
    }, {
        offset: '75%'
    });
    $('.wp9').waypoint(function () {
        $('.wp9').addClass('animated fadeInRight');
    }, {
        offset: '75%'
    });

    /***************** Initiate Flexslider ******************/
    $('.flexslider').flexslider({
        animation: "slide"
    });

    /***************** Initiate Fancybox ******************/

    $('.single_image').fancybox({
        padding: 4
    });

    $('.fancybox').fancybox({
        padding: 4,
        width: 1000,
        height: 800
    });

    /***************** Tooltips ******************/
    $('[data-toggle="tooltip"]').tooltip();

    /***************** Nav Transformicon ******************/

    /* When user clicks the Icon */
    $('.nav-toggle').click(function () {
        $(this).toggleClass('active');
        $('.header-nav').toggleClass('open');
        event.preventDefault();
    });
    /* When user clicks a link */
    $('.header-nav li a').click(function () {
        $('.nav-toggle').toggleClass('active');
        $('.header-nav').toggleClass('open');

    });

    /***************** Header BG Scroll ******************/

    $(function () {
        $(window).scroll(function () {
            var scroll = $(window).scrollTop();

            if (scroll >= 20) {
                $('section.navigation').addClass('fixed');
                $('header').css({
                    "border-bottom": "none",
                    "padding": "35px 0"
                });
                $('header .member-actions').css({
                    "top": "26px",
                });
                $('header .navicon').css({
                    "top": "34px",
                });
            } else {
                $('section.navigation').removeClass('fixed');
                $('header').css({
                    "border-bottom": "solid 1px rgba(255, 255, 255, 0.2)",
                    "padding": "50px 0"
                });
                $('header .member-actions').css({
                    "top": "41px",
                });
                $('header .navicon').css({
                    "top": "48px",
                });
            }
        });
    });
    /***************** Smooth Scrolling ******************/

    $(function () {

        $('a[href*=#]:not([href=#])').click(function () {
            if (location.pathname.replace(/^\//, '') === this.pathname.replace(/^\//, '') && location.hostname === this.hostname) {

                var target = $(this.hash);
                target = target.length ? target : $('[name=' + this.hash.slice(1) + ']');
                if (target.length) {
                    $('html,body').animate({
                        scrollTop: target.offset().top - 90
                    }, 1000);
                    return false;
                }
            }
        });

    });

    /********************** Social Share buttons ***********************/
    var share_bar = document.getElementsByClassName('share-bar');
    var po = document.createElement('script');
    po.type = 'text/javascript';
    po.async = true;
    po.src = 'https://apis.google.com/js/platform.js';
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(po, s);

    for (var i = 0; i < share_bar.length; i++) {
        var html = '<iframe allowtransparency="true" frameborder="0" scrolling="no"' +
            'src="https://platform.twitter.com/widgets/tweet_button.html?url=' + encodeURIComponent(window.location) + '&amp;text=' + encodeURIComponent(document.title) + '&amp;via=ramswarooppatra&amp;hashtags=ramandantara&amp;count=horizontal"' +
            'style="width:105px; height:21px;">' +
            '</iframe>' +

            '<iframe src="//www.facebook.com/plugins/like.php?href=' + encodeURIComponent(window.location) + '&amp;width&amp;layout=button_count&amp;action=like&amp;show_faces=false&amp;share=true&amp;height=21&amp;appId=101094500229731&amp;width=150" scrolling="no" frameborder="0" style="border:none; overflow:hidden; width:150px; height:21px;" allowTransparency="true"></iframe>' +

            '<div class="g-plusone" data-size="medium"></div>';

        // '<iframe src="https://plusone.google.com/_/+1/fastbutton?bsv&amp;size=medium&amp;url=' + encodeURIComponent(window.location) + '" allowtransparency="true" frameborder="0" scrolling="no" title="+1" style="width:105px; height:21px;"></iframe>';

        share_bar[i].innerHTML = html;
        share_bar[i].style.display = 'inline-block';
    }

    /********************** Embed youtube video *********************/
    $('.player').YTPlayer();


    /********************** Toggle Map Content **********************/
    $('#btn-show-map').click(function () {
        $('#map-content').toggleClass('toggle-map-content');
        $('#btn-show-content').toggleClass('toggle-map-content');
    });
    $('#btn-show-content').click(function () {
        $('#map-content').toggleClass('toggle-map-content');
        $('#btn-show-content').toggleClass('toggle-map-content');
    });

    /********************** Add to Calendar **********************/
    var myCalendar = createCalendar({
        options: {
            class: '',
            // You can pass an ID. If you don't, one will be generated for you
            id: ''
        },
        data: {
            // Event title
            title: window.rsvpText('calendarTitle'),
            timezone: 'America/Denver',

            // Event start date
            start: new Date('2027-04-10T18:00:00-06:00'),

            // Event duration (IN MINUTES)
            // duration: 120,

            // You can also choose to set an end time
            // If an end time is set, this will take precedence over duration
            end: new Date('2027-04-10T22:30:00-06:00'),

            // Event Address
            address: '14741 Allemands Ave, El Paso, TX 79928',

            // Event Description
            description: window.rsvpText('calendarDescription')
        }
    });

    $('#add-to-cal').html(myCalendar);


    /********************** RSVP **********************/
    $('#lookup-family-btn').on('click', function (e) {
        e.preventDefault();

        var phone = $('#guest_phone').val();
        var guestName = $('#guest_name').val();

        $('#alert-wrapper').html('');

        if (!phone) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> Please enter your phone number first.'));
            return;
        }

        if (!guestName) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> Please enter your full name.'));
            return;
        }

        if (!familyGroups || familyGroups.length === 0) {
            $('#alert-wrapper').html(alert_markup('info', '<strong>Loading family list...</strong> Please wait a moment and try again.'));
            return;
        }

        var family = findFamilyByMemberName(guestName);

        if (!family) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> We could not find that name in our family invite list.'));
            resetFamilyLookupState();
            return;
        }

        renderFamilyMatch(family);
    });

    $('#guest_name').on('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#lookup-family-btn').trigger('click');
        }
    });

    $('#check-all-family-btn').on('click', function () {
        var checkboxes = $('#family-members-list input[name="family-member-attending"]');
        var areChecked = checkboxes.length > 0 && checkboxes.filter(':checked').length === checkboxes.length;

        checkboxes.prop('checked', !areChecked);
        $('#family-cannot-attend').val('0');
        $('#cannot-attend-btn').removeClass('btn-accent').addClass('btn-default');
        updateFamilySelectionState(findFamilyByMemberName($('#guest_name').val()));
    });

    $('#cannot-attend-btn').on('click', function () {
        var isDeclining = $('#family-cannot-attend').val() === '1';
        var checkboxes = $('#family-members-list input[name="family-member-attending"]');

        if (isDeclining) {
            $('#family-cannot-attend').val('0');
            $(this).removeClass('btn-accent').addClass('btn-default');
            updateFamilySelectionState(findFamilyByMemberName($('#guest_name').val()));
            return;
        }

        checkboxes.prop('checked', false);
        $('#family-cannot-attend').val('1');
        $(this).removeClass('btn-default').addClass('btn-accent');
        updateFamilySelectionState(findFamilyByMemberName($('#guest_name').val()));
    });

    $('#rsvp-form').on('submit', function (e) {
        e.preventDefault();

        var guestName = $('#guest_name').val();
        var family = findFamilyByMemberName(guestName);
        var cannotAttend = $('#family-cannot-attend').val() === '1';
        var attendingNames = $('#attending-members-input').val() ? $('#attending-members-input').val().split('|').filter(Boolean) : [];
        var notAttendingNames = $('#not-attending-members-input').val() ? $('#not-attending-members-input').val().split('|').filter(Boolean) : [];

        $('#alert-wrapper').html('');

        if (!guestName) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> Please enter your full name.'));
            return;
        }

        if (!family) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> We could not find that name in our family invite list.'));
            return;
        }

        if (!cannotAttend && attendingNames.length < 1) {
            $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> Please select at least one attendee or choose "We cannot attend".'));
            return;
        }

        $('#alert-wrapper').html(alert_markup('info', window.rsvpText('savingRsvp')));

        family.status = 'confirmed';
        family.submittedBy = guestName;
        $('#extras-input').val(cannotAttend ? 0 : attendingNames.length);

        var noteValue = $('#rsvp-notes').val() || '';
        var data = {
            phone: $('#guest_phone').val(),
            name: guestName,
            family_id: family.familyId,
            family_name: family.familyName,
            family_members: family.members.join('|'),
            attending_members: attendingNames.join('|'),
            not_attending_members: notAttendingNames.join('|'),
            rsvp_count: cannotAttend ? 0 : attendingNames.length,
            extras: cannotAttend ? 0 : attendingNames.length,
            invite_code: family.familyId,
            submitted_by: guestName,
            status: cannotAttend ? 'declined' : 'confirmed',
            notes: noteValue,
            update_existing: family.status === 'confirmed' || family.status === 'declined' ? '1' : '0'
        };

        $.post(RSVP_SCRIPT_URL, data)
            .done(function (response) {
                console.log(response);
                if (response && response.result === 'error') {
                    $('#alert-wrapper').html(alert_markup('danger', response.message));
                } else {
                    $('#alert-wrapper').html('');
                    resetFamilyLookupState();
                    $('#rsvp-modal').modal('show');
                }
            })
            .fail(function (response) {
                console.log(response);
                $('#alert-wrapper').html(alert_markup('danger', '<strong>Sorry!</strong> There is some issue with the server.'));
            });
    });

});

/********************** Extras **********************/
var darkMapStyles = [
    {
        elementType: "geometry",
        stylers: [{ color: "#242424" }]
    },
    {
        elementType: "labels.text.fill",
        stylers: [{ color: "#b8b8b8" }]
    },
    {
        elementType: "labels.text.stroke",
        stylers: [{ color: "#242424" }]
    },
    {
        featureType: "road",
        elementType: "geometry",
        stylers: [{ color: "#3a3a3a" }]
    },
    {
        featureType: "road",
        elementType: "geometry.stroke",
        stylers: [{ color: "#1f1f1f" }]
    },
    {
        featureType: "water",
        elementType: "geometry",
        stylers: [{ color: "#172027" }]
    },
    {
        featureType: "poi",
        elementType: "geometry",
        stylers: [{ color: "#303030" }]
    },
    {
        featureType: "transit",
        elementType: "geometry",
        stylers: [{ color: "#303030" }]
    }
];

// Google map
function getMapInfoWindowContent() {
    var language = localStorage.getItem('wedding-language') || 'en';
    var venueName = language === 'es' ? 'Patio de la Familia Ayala' : 'Ayala Family Backyard';
    var venueAddress = '14741 Allemands Ave, El Paso, TX 79928';

    return '<div class="map-info-window">' +
        '<strong><a href="https://www.google.com/maps/dir/?api=1&destination=31.685082582261813,-106.1621363988813" target="_blank" rel="noopener noreferrer">' + venueName + '</a></strong><br>' +
        '<a href="https://www.google.com/maps/dir/?api=1&destination=31.685082582261813,-106.1621363988813" target="_blank" rel="noopener noreferrer">' +
        venueAddress +
        '</a>' +
        '</div>';
}

function initMap() {
    var location = {
        lat: 31.685082582261813,
        lng: -106.1621363988813
    };

    var map = new google.maps.Map(document.getElementById('map-canvas'), {
        zoom: 15,
        center: location,
        scrollwheel: false,
        styles: document.body.classList.contains('dark-mode') ? darkMapStyles : []
    });
    window.weddingMap = map;

    var marker = new google.maps.Marker({
        position: location,
        map: map
    });

    var infoWindow = new google.maps.InfoWindow({
        content: getMapInfoWindowContent()
    });
    window.weddingInfoWindow = infoWindow;

    marker.addListener('click', function () {
        infoWindow.setContent(getMapInfoWindowContent());
        infoWindow.open(map, marker);
    });

    // Show the popup automatically when the map loads
    infoWindow.open(map, marker);
}

function initBBSRMap() {
    var la_fiesta = {lat: 31.685082582261813, lng:  -106.1621363988813};
    var map = new google.maps.Map(document.getElementById('map-canvas'), {
        zoom: 15,
        center: la_fiesta,
        scrollwheel: false
    });

    var marker = new google.maps.Marker({
        position: la_fiesta,
        map: map
    });
}

// alert_markup
function alert_markup(alert_type, msg) {
    return '<div class="alert alert-' + alert_type + '" role="alert">' + msg + '<button type="button" class="close" data-dismiss="alert" aria-label="Close"><span>&times;</span></button></div>';
}

// MD5 Encoding
var MD5 = function (string) {

    function RotateLeft(lValue, iShiftBits) {
        return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits));
    }

    function AddUnsigned(lX, lY) {
        var lX4, lY4, lX8, lY8, lResult;
        lX8 = (lX & 0x80000000);
        lY8 = (lY & 0x80000000);
        lX4 = (lX & 0x40000000);
        lY4 = (lY & 0x40000000);
        lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
        if (lX4 & lY4) {
            return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
        }
        if (lX4 | lY4) {
            if (lResult & 0x40000000) {
                return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
            } else {
                return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
            }
        } else {
            return (lResult ^ lX8 ^ lY8);
        }
    }

    function F(x, y, z) {
        return (x & y) | ((~x) & z);
    }

    function G(x, y, z) {
        return (x & z) | (y & (~z));
    }

    function H(x, y, z) {
        return (x ^ y ^ z);
    }

    function I(x, y, z) {
        return (y ^ (x | (~z)));
    }

    function FF(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    };

    function GG(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    };

    function HH(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    };

    function II(a, b, c, d, x, s, ac) {
        a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
        return AddUnsigned(RotateLeft(a, s), b);
    };

    function ConvertToWordArray(string) {
        var lWordCount;
        var lMessageLength = string.length;
        var lNumberOfWords_temp1 = lMessageLength + 8;
        var lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
        var lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
        var lWordArray = Array(lNumberOfWords - 1);
        var lBytePosition = 0;
        var lByteCount = 0;
        while (lByteCount < lMessageLength) {
            lWordCount = (lByteCount - (lByteCount % 4)) / 4;
            lBytePosition = (lByteCount % 4) * 8;
            lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount) << lBytePosition));
            lByteCount++;
        }
        lWordCount = (lByteCount - (lByteCount % 4)) / 4;
        lBytePosition = (lByteCount % 4) * 8;
        lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80 << lBytePosition);
        lWordArray[lNumberOfWords - 2] = lMessageLength << 3;
        lWordArray[lNumberOfWords - 1] = lMessageLength >>> 29;
        return lWordArray;
    };

    function WordToHex(lValue) {
        var WordToHexValue = "", WordToHexValue_temp = "", lByte, lCount;
        for (lCount = 0; lCount <= 3; lCount++) {
            lByte = (lValue >>> (lCount * 8)) & 255;
            WordToHexValue_temp = "0" + lByte.toString(16);
            WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
        }
        return WordToHexValue;
    };

    function Utf8Encode(string) {
        string = string.replace(/\r\n/g, "\n");
        var utftext = "";

        for (var n = 0; n < string.length; n++) {

            var c = string.charCodeAt(n);

            if (c < 128) {
                utftext += String.fromCharCode(c);
            }
            else if ((c > 127) && (c < 2048)) {
                utftext += String.fromCharCode((c >> 6) | 192);
                utftext += String.fromCharCode((c & 63) | 128);
            }
            else {
                utftext += String.fromCharCode((c >> 12) | 224);
                utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                utftext += String.fromCharCode((c & 63) | 128);
            }

        }

        return utftext;
    };

    var x = Array();
    var k, AA, BB, CC, DD, a, b, c, d;
    var S11 = 7, S12 = 12, S13 = 17, S14 = 22;
    var S21 = 5, S22 = 9, S23 = 14, S24 = 20;
    var S31 = 4, S32 = 11, S33 = 16, S34 = 23;
    var S41 = 6, S42 = 10, S43 = 15, S44 = 21;

    string = Utf8Encode(string);

    x = ConvertToWordArray(string);

    a = 0x67452301;
    b = 0xEFCDAB89;
    c = 0x98BADCFE;
    d = 0x10325476;

    for (k = 0; k < x.length; k += 16) {
        AA = a;
        BB = b;
        CC = c;
        DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478);
        d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB);
        b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF);
        d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613);
        b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8);
        d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1);
        b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122);
        d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E);
        b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562);
        d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51);
        b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D);
        d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681);
        b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6);
        d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87);
        b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905);
        d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9);
        b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942);
        d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122);
        b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44);
        d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60);
        b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6);
        d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085);
        b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039);
        d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8);
        b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244);
        d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7);
        b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3);
        d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D);
        b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F);
        d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314);
        b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82);
        d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB);
        b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = AddUnsigned(a, AA);
        b = AddUnsigned(b, BB);
        c = AddUnsigned(c, CC);
        d = AddUnsigned(d, DD);
    }

    var temp = WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d);

    return temp.toLowerCase();
};