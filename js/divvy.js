

// utility functions (mostly for calculating geographic distance)
var util = (function() {
    "use strict";
    var u = {};

    var nauticalMilePerLat = 60.00721,
        nauticalMilePerLng = 60.10793,
        milesPerNauticalMile = 1.15078,
        rad = Math.PI / 180.0;

    // computes the NW and SE corners of a square box that completely
    // encloses a circle for fast filtering of locations within
    // a certian radius
    u.distanceBox = function(lat, lng, radius) {
        var latR = radius / (milesPerNauticalMile * 60.0);
        var lngR = radius / (Math.cos(lat * rad) * milesPerNauticalMile * 60.0);

        return [lat + latR, lng - lngR, lat - latR, lng + lngR];
    };

    u.boxContainsPoint = function(box, lat, lng) {
        // assumes order of points is same as returned by util.distanceBox
        // also only works in NW hemisphere
        return (lat < box[0] &&
                lng > box[1] &&
                lat > box[2] &&
                lng < box[3]);
    };

    u.distance = function(lat1, lng1, lat2, lng2) {
        // convert from degress to radians
        lat1 = lat1 * rad, lat2 = lat2 * rad, lng1 = lng1 * rad, lng2 = lng2 * rad;

        var R = 3963; // radius of earth in miles

        // the law of cosines
        // this is faster than haversine and apparently as accurate
        // now that we live in the future and we have nice floating point numbers
        // http://www.movable-type.co.uk/scripts/latlong.html

        return Math.acos(Math.sin(lat1) * Math.sin(lat2) + 
            Math.cos(lat1) * Math.cos(lat2) *
            Math.cos(lng2 - lng1)) * R;
    };

    u.pointsWithinDistance = function(lat1, lng1, lat2, lng2, distance) {
        return u.distance(lat1, lng1, lat2, lng2) <= distance;
    }

    return u;

})();

// manage the station data from Divvy
var stations = (function() {
    "use strict";

    var s = {}, templates = {};
    templates.infoWindow = _.template($('#-tmpl-station-infowindow').html());

    s.Station = Backbone.Model.extend({
        drawMarker: function(map) {
            var marker = new google.maps.Marker({
                position: new google.maps.LatLng(this.attributes.latitude, this.attributes.longitude),
                maxWidth: 500,
                map: map
            });
            var attributes = this.attributes;

            var showInfo = function() {
                console.log(attributes);
                var options = {
                    content: templates.infoWindow(attributes),
                    position: marker.position
                };
                var infoWindow = new google.maps.InfoWindow(options);
                infoWindow.setMap(map);
            };
            google.maps.event.addListener(marker, "click", showInfo);

            marker.stationID = this.attributes.id;

            return marker;
        },
    });

    s.StationList = Backbone.Collection.extend({
        url: "divvy.json",
        model: s.Station,
        parse: function(response) {
            this.executionTime = response.executionTime;

            return response.stationBeanList;
        },
        nearPoint: function(lat, lng, radius) {
            var box = util.distanceBox(lat, lng, radius);
            this.bounds = new google.maps.LatLngBounds(new google.maps.LatLng(box[0], box[1]), new google.maps.LatLng(box[2], box[3]));

            var points = _.filter(this.models, function(station) {
                return util.boxContainsPoint(box, station.attributes.latitude, station.attributes.longitude) &&
                util.pointsWithinDistance(lat, lng, station.attributes.latitude, station.attributes.longitude, radius);
            });
            return points;
        }
    });

    return s

})(util);

/*
var github = (function() {
    "use strict";
    var g = {};

    g.Star = Backbone.Model.extend({});

    var username = 'paulbersch', password = 'password';

    $.ajaxSettings.headers = {
        'Accept': 'application/vnd.github.raw+json',
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': 'Basic ' + btoa(username + ':' + password)
    };

    g.StarList = Backbone.Collection.extend({
        url: "https://api.github.com/user/starred/",
        model: g.Star,
        parse: function(response) {
            console.log(response);
            return response;
        }
    });
    return g;
})();

var g = new github.StarList;

console.log(g);

g.fetch({ success: function(c) { console.log(c); }});
*/

// draw markers and handle map manipulations
var map = (function(panel) { 
    "use strict";
    var map, center, list, geocoder, markers = {};

    var mapOptions = {
        center: new google.maps.LatLng(41.90, -87.65),
        zoom: 13,
        mapTypeId: google.maps.MapTypeId.ROADMAP
    };

    var b = {};

    b.clearMarkers = function() {
        var i, x, l, key, keys = Object.keys(markers);

        for (i in keys) {
            key = keys[i];
            for (x = 0, l = markers[key].length; x < l; x++) {
                markers[key][x].setMap();
                delete markers[key][x];
            }
            delete markers[key];
        }
    };

    b.recenter = function() {
        map.setCenter(center);
    };

    b.drawNearbyStations = function(lat, lng, radius) {
        center = new google.maps.LatLng(lat, lng);
        map.setCenter(center);

        // draw a radius circle
        if (markers['polygons'] === undefined) markers['polygons'] = [];
        markers['polygons'].push(new google.maps.Circle({
            center: center,
            fillColor: 'blue',
            fillOpacity: .2,
            strokeColor: 'blue',
            strokeOpacity: .3,
            strokeWeight: 2,
            map: map,
            radius: radius * 1609.34 * 1.02 // meters per mile plus a small fudge
        }))

        if (list === undefined) {
            list = new stations.StationList;
        }

        var filterAndDraw = function(stationCollection) {
            var stations = stationCollection.nearPoint(lat, lng, radius);
            map.fitBounds(stationCollection.bounds);
            markers['search-nearby'] = _.invoke(stations, "drawMarker", map);
        };

        list.fetch({
            success: filterAndDraw
        });
    }

    b.search = function(address, radius) {
        console.log('searching');
        if (typeof address == 'object') {
            console.log('searching');
            b.drawNearbyStations(address['lat'], address['lng'], radius);
            console.log('searching');
            return;
        }

        if (geocoder === undefined) {
            geocoder = new google.maps.Geocoder();
        }

        geocoder.geocode({
            'address': address
        }, function(results, status) {
            if (status == google.maps.GeocoderStatus.OK) {
                b.drawNearbyStations(results[0].geometry.location.lat(), results[0].geometry.location.lng(), radius);
            }
        });
    };

    b.init = function() {
        Backbone.history.start({
            pushState: false,
            root: '/files/experiments/divvy-trip-planner/'
        });
        map = new google.maps.Map(document.getElementById("map"), mapOptions);

        $("#loading").on("transitionend", function() {
            console.log("transitionend");
            var e = $(this);
            if (e.css("opacity") == 0) {
                e.css("display", "none");
            } else {
                e.css("display", "block");
            }
        });
    };

    var loading = $("#loading");

    b.toggleLoading = function() {
        loading.css("opacity", loading.css("opacity") == 0 ? 100 : 0); 
    }

    return b;
})(stations);

// the control panel
var panel = (function() {
    "use strict";
    var templates = {}, recenterTimeout;

    var p = {};

    p.init = function() {
        templates.searchForm = _.template($('#-tmpl-panel-search-form').html());
        templates.directionsForm = _.template($('#-tmpl-panel-directions-form').html());
        templates.tabs = _.template($('#-tmpl-panel-tabs').html());
        templates.about = _.template($('#-tmpl-panel-about').html());
        $(window).resize(p.slidePanel);
        return this;
    };

    p.slidePanel = function() {
        $("#map").css('height', $(window).height());
        $("#wrapper").css('height', $(window).height());
        $('#main-panel').css('top', $(window).height() - $('#main-panel').height() + 50);
        if (recenterTimeout) {
            clearTimeout(recenterTimeout);
        }
        setTimeout(map.recenter, 300);
    };

    p.about = function() {
        $('#main-panel').html(
            templates.tabs({}) +
            templates.about()
        );
        p.slidePanel();
    };

    p.searchForm = function(initial_address, initial_radius) {
        $('#main-panel').html(
            templates.tabs({}) +
            templates.searchForm({
                address: initial_address,
                radius: initial_radius
        }));
        $("#main-panel .clear-button").on("click", map.clearMarkers);

        $("#main-panel #radius-search-form").on("submit", function(e) {
            var form = $(e.target).serializeArray();
            console.log(form);

            e.preventDefault();
            // serializeArray outputs the dumbest data structure
            Backbone.history.navigate("/search/" + encodeURIComponent(form[0]['value']) + "/" + encodeURIComponent(form[1]['value']), {
                trigger: true
            });
            return false;
        });
        p.slidePanel();
    };

    p.directionsForm = function(start_address, start_station, end_address, end_station) {
        $('#main-panel').html(
            templates.tabs({}) +
            templates.directionsForm({
                start_address: start_address,
                end_address: end_address,
        }));

        $("#main-panel .clear-button").on("click", map.clearMarkers);

        $("#main-panel #directions-form").on("submit", function(e) {
            var form = $(e.target).serializeArray();
            console.log(form);
            console.log($(e.target).serialize());

            e.preventDefault();
            // serializeArray outputs the dumbest data structure
            Backbone.history.navigate("/search/" + encodeURIComponent(form[0]['value']) + "/" + encodeURIComponent(form[1]['value']), {
                trigger: true
            });
            return false;
        });
        p.slidePanel();
    };

    return p.init();

})(map);

var router = (function() {
    "use strict";
    var r = Backbone.Router.extend({
        routes: {
            'search': "search",
            'search/mylocation/:radius': "search_mylocation",
            'search/mylocation/:radius/': "search_mylocation",
            'search/:address/:radius/': "search",
            'search/:address/:radius': "search",
            'directions*pathInfo': "directions",
            'about': "about",
            '*stuff': "default"
        },
        default: function() {
            Backbone.history.navigate("/search/Chicago+IL/8/", {
                trigger: true
            });
        },
        search: function(address, radius) {
            panel.searchForm(address, radius);
            map.clearMarkers();
            map.search(address, radius);
        },
        search_mylocation: function(radius) {
            panel.searchForm('My Current Location', radius);
            map.clearMarkers();
            navigator.geolocation.getCurrentPosition(function(position) {
                console.log(position);
                map.search({
                    lat: position['coords'].latitude, 
                    lng: position['coords'].longitude
                }, radius);
            });
        },
        directions: function() {
            map.clearMarkers();
            panel.directionsForm();
        },
        about: function() {
            panel.about();
        }
    });

    return new r;
})(panel);

$(document).ready(map.init);
