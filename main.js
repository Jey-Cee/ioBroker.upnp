/**
 *
 * template adapter
 *
 *
 *  file io-package.json comments:
 *
 *  {
 *      "common": {
 *          "name":         "upnp",                  					// name has to be set and has to be equal to adapters folder name and main file name excluding extension
 *          "version":      "0.1.0",                    						// use "Semantic Versioning"! see http://semver.org/
 *          "title":        "upnp Adapter",  							// Adapter title shown in User Interfaces
 *          "authors":  [                               						// Array of authord
 *              "Jey Cee <jey-cee@live.com>"
 *          ]
 *          "desc":         "Discovers upnp clients on the Network",          	// Adapter description shown in User Interfaces. Can be a language object {de:"...",ru:"..."} or a string
 *          "platform":     "Javascript/Node.js",       						// possible values "javascript", "javascript/Node.js" - more coming
 *          "mode":         "daemon",                   						// possible values "daemon", "schedule", "subscribe"
 *          "schedule":     "0 0 * * *"                 						// cron-style schedule. Only needed if mode=schedule
 *          "loglevel":     "info"                      						// Adapters Log Level
 *      },
 *      "native": {                                     						// the native object is available via adapter.config in your adapters code - use it for configuration
 *          "test1": true,
 *          "test2": 42
 *      }
 *  }
 *
 */

/* jshint -W097 */// jshint strict:false
/*jslint node: true */
"use strict";

// you have to require the utils module and call adapter function
var utils = require(__dirname + '/lib/utils'); // Get common adapter utils

//include node-ssdp
var Client = require('node-ssdp').Client;
var client = new Client();


// you have to call the adapter function and pass a options object
// name has to be set and has to be equal to adapters folder name and main file name excluding extension
// adapter will be restarted automatically every time as the configuration changed, e.g system.adapter.template.0
var adapter = utils.adapter('upnp');

// is called when adapter shuts down - callback has to be called under any circumstances!
adapter.on('unload', function (callback) {
    try {
        adapter.log.info('cleaned everything up...');
        callback();
    } catch (e) {
        callback();
    }
});

// is called if a subscribed object changes
adapter.on('objectChange', function (id, obj) {
    // Warning, obj can be null if it was deleted
    adapter.log.info('objectChange ' + id + ' ' + JSON.stringify(obj));
});

// is called if a subscribed state changes
adapter.on('stateChange', function (id, state) {
    // Warning, state can be null if it was deleted
    adapter.log.info('stateChange ' + id + ' ' + JSON.stringify(state));

    // you can use the ack flag to detect if it is status (true) or command (false)
    if (state && !state.ack) {
        adapter.log.info('ack is not set!');
    }
});


// is called when databases are connected and adapter received configuration.
// start here!
adapter.on('ready', main);

var foundIPs = []; // Array for the caught broadcast answers
var parseString = require('xml2js').parseString;
var request     = require('request');

function main() {

    sendBroadcastToAll();

    //Filtering the Device description file addresses, timeout is necessary to wait for all answers
    setTimeout(function () {
        adapter.log.debug("Found " + foundIPs.length + " devices");
    }, 5000);
}

function sendBroadcastToAll() {
    adapter.log.debug("Send Broadcast");

    //Sends a Broadcast and catch the URL with xml device description file
    client.on('response', function (headers, statusCode, rinfo) {
        var strHeaders = JSON.stringify(headers, null, ' ');
        var jsonAnswer = JSON.parse(strHeaders);
        var answer = jsonAnswer.LOCATION;

        if (foundIPs.indexOf(answer) === -1) {
            foundIPs.push(answer);

            // process immediately and do not wait 5 seconds
            setTimeout(function () {
                firstDevLookup(answer);
            }, 500);
        }
    });

    client.search('ssdp:all');
}

//START Reading the xml device description file of each upnp device the first time
function firstDevLookup(strLocation) {


    adapter.log.debug("firstDevLookup for " + strLocation);

    request(strLocation, function (error, response, body) {
                if (!error && response.statusCode == 200) {
                    adapter.log.debug("Positive answer for request of the XML file for " + strLocation);


            try {
                parseString(body, {
                        explicitArray: false,
                        mergeAttrs:    true
                    },
                    function (err, result) {
                        adapter.log.debug("Parsing the XML file for " + strLocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {
                            adapter.log.debug("Creating objects for " + strLocation);
                            var i;

                            if (!result || !result.root || !result.root.device) {
                                adapter.log.warn('Error by parsing of ' + strLocation + ': Cannot find deviceType');
                                return;
                            }

                            //Looking for deviceType of device
                            try {
                                var xmlDeviceType = JSON.stringify(result.root.device.deviceType);
                                xmlDeviceType = xmlDeviceType.replace(/"/g, "");
                                var xmlTypeOfDevice = xmlDeviceType.replace(/:\d/, "");
                                xmlTypeOfDevice = xmlTypeOfDevice.replace(/.*:/, "");
                                adapter.log.debug("TypeOfDevice " + xmlTypeOfDevice);
                            } catch(err){
                                adapter.log.debug("Can not read deviceType of " + strLocation);
                                xmlDeviceType = "";
                            }

                            //Looking for the port
                            var strPort = strLocation.replace(/\bhttp:\/\/.*\d:/ig, "");
                            strPort = strPort.replace(/\/.*/ig, "");


                            //Looking for the IP of a device
                            strLocation = strLocation.replace(/http:\/\//g, "");
                            strLocation = strLocation.replace(/:\d*\/.*/ig, "");

                            //Looking for UDN of a device
                            try {
                                var xmlUDN = JSON.stringify(result.root.device.UDN);
                                xmlUDN = xmlUDN.replace(/"/g, "");
                                xmlUDN = xmlUDN.replace(/uuid:/g, "");
                            } catch(err) {
                                adapter.log.debug("Can not read UDN of " + strLocation);
                                xmlUDN = "";
                            }

                            //Looking for the manufacturer of a device
                            try {
                                var xmlManufacturer = JSON.stringify(result.root.device.manufacturer);
                                xmlManufacturer = xmlManufacturer.replace(/"/g, "");
                            } catch(err){
                                adapter.log.debug("Can not read manufacturer of " + strLocation);
                                xmlManufacturer = "";
                            }

                            //Extract the path to the device icon that is delivered by the device
                            var i_icons = 0;
                            var xmlIconURL;
                            var xmlFriendlyName;
                            var xmlFN;
                            var xmlManufacturerURL;
                            var xmlModelNumber;
                            var xmlModelDescription;
                            var xmlModelName;
                            var xmlModelURL;

                            try {
                                if (result.root.device.iconList && result.root.device.iconList.icon) {
                                    i_icons = result.root.device.iconList.icon.length;

                                    adapter.log.debug("Number of icons: " + result.root.device.iconList.icon.length);

                                    if (i_icons) {
                                        xmlIconURL = result.root.device.iconList.icon[0].url;
                                        adapter.log.debug("More than one icon in the list: " + xmlIconURL);
                                    }
                                    else if (result.root.device.iconList.icon) {
                                        xmlIconURL = JSON.stringify(result.root.device.iconList.icon.url);
                                        adapter.log.debug("Only one icon in the list: " + xmlIconURL)
                                    }

                                    xmlIconURL = xmlIconURL.replace(/"/g, "");
                                }
                            } catch(err){
                                adapter.log.debug("Can not find a icon for " + strLocation);
                                xmlIconURL = "";
                            }
                            //Looking for the freiendlyName of a device
                            try {
                                xmlFriendlyName = JSON.stringify(result.root.device.friendlyName);
                                xmlFN = xmlFriendlyName.replace(/\./g, "_");
                                xmlFN = xmlFN.replace(/"/g, "");
                            } catch(err){
                                adapter.log.debug("Can not read friendlyName of " + strLocation);
                                xmlFriendlyName = "Unknown";
                            }

                            //Looking for the manufacturerURL
                            try {
                                xmlManufacturerURL = JSON.stringify(result.root.device.manufacturerURL);
                                xmlManufacturerURL = xmlManufacturerURL.replace(/"/g, "");
                            } catch(err){
                                adapter.log.debug("Can not read manufacturerURL of " + strLocation);
                                xmlManufacturerURL = "";
                            }

                            //Looking for the modelNumber
                            try {
                                xmlModelNumber = JSON.stringify(result.root.device.modelNumber);
                                xmlModelNumber = xmlModelNumber.replace(/"/g, "");
                            } catch(err) {
                                adapter.log.debug("Can not read modelNumber of " + strLocation);
                                xmlModelNumber = "";
                            }

                            //Looking for the modelDescription
                            try {
                                xmlModelDescription = JSON.stringify(result.root.device.modelDescription);
                                xmlModelDescription = xmlModelDescription.replace(/"/g, "");
                            } catch(err){
                                adapter.log.debug("Can not read modelDescription of " + strLocation);
                                xmlModelDescription = "";
                            }

                            //Looking for the modelName
                            try {
                                xmlModelName = JSON.stringify(result.root.device.modelName);
                                xmlModelName = xmlModelName.replace(/"/g, "");
                            } catch(err){
                                adapter.log.debug("Can not read modelName of " + strLocation);
                                xmlModelName = "";
                            }

                            //Looking for the modelURL
                            try {
                                xmlModelURL = JSON.stringify(result.root.device.modelURL);
                                xmlModelURL = xmlModelURL.replace(/"/g, "");
                            }catch(err){
                                adapter.log.debug("Can not read modelURL of " + strLocation);
                                xmlModelURL = "";
                            }


                            //START - Creating the root object of a device
                            adapter.log.debug('creating root element for device: ' + xmlFN);

                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice, {
                                type: 'device',
                                common: {
                                    name: xmlFN,
                                    extIcon: "http://" + strLocation + ":" + strPort + xmlIconURL
                                },
                                native: {
                                    ip:                 strLocation,
                                    port:               strPort,
                                    uuid:               xmlUDN,
                                    deviceType:         xmlDeviceType,
                                    manufacturer:       xmlManufacturer,
                                    manufacturerURL:    xmlManufacturerURL,
                                    modelNumber:        xmlModelNumber,
                                    modelDescription:   xmlModelDescription,
                                    modelName:          xmlModelName,
                                    modelURL:           xmlModelURL
                                }
                            });
                            //END - Creating the root object of a device


                            //START - Creating service list for a device
                            var i_services = 0;
                            var xmlService;
                            var xmlServiceType;
                            var xmlServiceID;
                            var xmlControlURL;
                            var xmlEventSubURL;
                            var xmlSCPDURL;

                            if (result.root.device.serviceList && result.root.device.serviceList.service) {
                                i_services = result.root.device.serviceList.service.length;

                                //Counting services
                                adapter.log.debug("Number of services: " + result.root.device.serviceList.service.length);

                                if (i_services) {
                                    adapter.log.debug("Found more than one service");
                                    for (i = i_services - 1; i >= 0; i--) {

                                        try {
                                            xmlService = result.root.device.serviceList.service[i].serviceType;
                                            xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                            xmlService = xmlService.replace(/:\d/g, "");
                                            xmlService = xmlService.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read service of " +  xmlFN);
                                            xmlService = "Unknown";
                                        }

                                        try {
                                            xmlServiceType = result.root.device.serviceList.service[i].serviceType;
                                        } catch(err){
                                            adapter.log.debug("Can not read serviceType of " + xmlService);
                                            xmlServiceType = "";
                                        }

                                        try {
                                            xmlServiceID = result.root.device.serviceList.service[i].serviceId;
                                        } catch(err){
                                            adapter.log.debug("Can not read serviceID of " + xmlService);
                                            xmlServiceID = "";
                                        }

                                        try {
                                            xmlControlURL = result.root.device.serviceList.service[i].controlURL;
                                        } catch(err){
                                            adapter.log.debug("Can not read controlURL of " + xmlService);
                                            xmlControlURL = "";
                                        }

                                        try {
                                            xmlEventSubURL = result.root.device.serviceList.service[i].eventSubURL;
                                        } catch(err){
                                            adapter.log.debug("Can not read eventSubURL of " + xmlService);
                                            xmlEventSubURL = "";
                                        }

                                        try {
                                            xmlSCPDURL = result.root.device.serviceList.service[i].SCPDURL;
                                        } catch(err){
                                            adapter.log.debug("Can not read SCPDURL of " + xmlService);
                                            xmlSCPDURL = "";
                                        }

                                        adapter.log.debug(i + " " + xmlService + " " + xmlControlURL);

                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlService, {
                                            type: 'channel',
                                            common: {
                                                name: xmlService
                                            },
                                            native: {
                                                serviceType: xmlServiceType,
                                                serviceID:   xmlServiceID,
                                                controlURL:  xmlControlURL,
                                                eventSubURL: xmlEventSubURL,
                                                SCPDURL:     xmlSCPDURL
                                            }
                                        });
                                        var SCPDlocation = "http://" + strLocation + ":" + strPort + xmlSCPDURL;
                                        var service = xmlFN + '.' + xmlTypeOfDevice + '.' +  xmlService;
                                        readSCPD(SCPDlocation, service);


                                        //Dummy State
                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlService + '.dummyState', {
                                            type: 'state',
                                            common: {
                                                name: 'Dummy State',
                                                type: 'boolean',
                                                role: 'indicator.test',
                                                write: false,
                                                read: true
                                            },
                                            native: {}
                                        });
                                    }
                                }
                                else if (result.root.device.serviceList.service) {
                                    adapter.log.debug("Found only one service");

                                    try {
                                        xmlService = JSON.stringify(result.root.device.serviceList.service.serviceType);
                                        xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                        xmlService = xmlService.replace(/:\d/g, "");
                                        xmlService = xmlService.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read service of " + xmlFN);
                                        xmlService = "Unknown";
                                    }
                                    adapter.log.debug("Service Name: " + xmlService);

                                    try {
                                        xmlServiceType = JSON.stringify(result.root.device.serviceList.service.serviceType);
                                        xmlServiceType = xmlServiceType.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read serviceType of " + xmlFN);
                                        xmlServiceType = "";
                                    }

                                    try {
                                        xmlServiceID = JSON.stringify(result.root.device.serviceList.service.serviceId);
                                        xmlServiceID = xmlServiceID.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read serviceID of " + xmlFN);
                                        xmlServiceID = "";
                                    }

                                    try {
                                        xmlControlURL = JSON.stringify(result.root.device.serviceList.service.controlURL);
                                        xmlControlURL = xmlControlURL.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read controlURL of " + xmlFN);
                                        xmlControlURL = "";
                                    }

                                    try {
                                        xmlEventSubURL = JSON.stringify(result.root.device.serviceList.service.eventSubURL);
                                        xmlEventSubURL = xmlEventSubURL.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read eventSubURL of " + xmlFN);
                                        xmlEventSubURL = "";
                                    }

                                    try {
                                        xmlSCPDURL = JSON.stringify(result.root.device.serviceList.service.SCPDURL);
                                        xmlSCPDURL = xmlSCPDURL.replace(/\"/g, "");
                                    } catch(err) {
                                        adapter.log.debug("Can not read SCPDURL of " + xmlFN);
                                        xmlSCPDURL ="";
                                    }

                                    adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlService, {
                                        type: 'channel',
                                        common: {
                                            name: xmlService

                                        },
                                        native: {
                                            serviceType: xmlServiceType,
                                            serviceID:   xmlServiceID,
                                            controlURL:  xmlControlURL,
                                            eventSubURL: xmlEventSubURL,
                                            SCPDURL:     xmlSCPDURL
                                        }
                                    });
                                    //Dummy State
                                    adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlService + '.dummyState', {
                                        type: 'state',
                                        common: {
                                            name: 'Dummy State',
                                            type: 'boolean',
                                            role: 'indicator.test',
                                            write: false,
                                            read: true
                                        },
                                        native: {}
                                    });
                                }
                            }
                        }
                        //END - Creating service list for a device


                        //START - Creating SubDevices list for a device
                        var i_SubDevices = 0;
                        var varSubDevices = result.root.device.deviceList;
                        var xmlfriendlyName;


                        if (varSubDevices && result.root.device.deviceList.device) {
                            //Counting SubDevices
                            i_SubDevices = result.root.device.deviceList.device.length;

                            adapter.log.debug("Number of SubDevieces: " + i_SubDevices);

                            if (i_SubDevices) {
                                adapter.log.debug("Found more than one SubDevice");
                                for (i = i_SubDevices - 1; i >= 0; i--) {
                                    adapter.log.debug("i and i_SubDevices: " + i + " " + i_SubDevices);
                                    adapter.log.debug("Device " + i + " " + result.root.device.deviceList.device[i].friendlyName);
                                    //Looking for the freiendlyName of the SubDevice
                                    try{
                                    xmlfriendlyName = result.root.device.deviceList.device[i].friendlyName;
                                    xmlfriendlyName = xmlfriendlyName.replace(/\./g, "_");
                                    xmlfriendlyName = xmlfriendlyName.replace(/\"/g, "");
                                    } catch(err){
                                        adapter.log.debug("Can not read friendlyName of SubDevice from " + xmlFN);
                                        xmlfriendlyName = "Unknown";
                                    }
                                    //Looking for the manufacturer of a device
                                    try {
                                        xmlManufacturer = result.root.device.deviceList.device[i].manufacturer;
                                        xmlManufacturer = xmlManufacturer.replace(/\"/g, "");
                                    } catch(err) {
                                        adapter.log.debug("Can not read manufacturer of " + xmlfriendlyName);
                                        xmlManufacturer = "";
                                    }
                                    //Looking for the manufacturerURL
                                    try {
                                        xmlManufacturerURL = result.root.device.device.deviceList.device[i].manufacturerURL;
                                    } catch (err){
                                        adapter.log.debug("Can not read manufacturerURL of " + xmlfriendlyName);
                                        xmlManufacturerURL = "";
                                    }
                                    //Looking for the modelNumber
                                    try {
                                        xmlModelNumber = result.root.device.deviceList.device[i].modelNumber;
                                    } catch(err){
                                        adapter.log.debug("Can not read modelNumber of " + xmlfriendlyName);
                                        xmlModelNumber = "";
                                    }
                                    //Looking for the modelDescription
                                    try {
                                        xmlModelDescription = result.root.device.deviceList.device[i].modelDescription;
                                    } catch(err){
                                        adapter.log.debug("Can not read modelDescription of " + xmlfriendlyName);
                                        xmlModelDescription = "";
                                    }
                                    //Looking for deviceType of device
                                    try {
                                        xmlDeviceType = result.root.device.deviceList.device[i].deviceType;
                                    } catch(err){
                                        adapter.log.debug("Can not read DeviceType of " + xmlfriendlyName);
                                        xmlDeviceType = "";
                                    }
                                    //Looking for the modelName
                                    try {
                                        xmlModelName = result.root.device.deviceList.device[i].modelName;
                                    }catch(err){
                                        adapter.log.debug("Can not read modelName of " + xmlfriendlyName);
                                        xmlModelName = "";
                                    }
                                    //Looking for the modelURL
                                    try {
                                        xmlModelURL = result.root.device.deviceList.device[i].modelURL;
                                    } catch(err){
                                        adapter.log.debug("Can not read modelURL of " + xmlfriendlyName);
                                        xmlModelURL = "";
                                    }
                                    //Looking for UDN of a device
                                    try {
                                        xmlUDN = result.root.device.deviceList.device[i].UDN;
                                        xmlUDN = xmlUDN.replace(/"/g, "");
                                        xmlUDN = xmlUDN.replace(/uuid:/g, "");
                                    }catch(err){
                                        adapter.log.debug("Can not read UDN of " + xmlfriendlyName);
                                        xmlUDN = "";
                                    }

                                    //The SubDevice object
                                    adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName, {
                                        type: 'device',
                                        common: {
                                            name: xmlfriendlyName
                                        },
                                        native: {
                                            uuid: xmlUDN,
                                            deviceType: xmlDeviceType,
                                            manufacturer: xmlManufacturer,
                                            manufacturerURL: 	xmlManufacturerURL,
                                            modelNumber: xmlModelNumber,
                                            modelDescription: xmlModelDescription,
                                            modelName: xmlModelName,
                                            modelURL: xmlModelURL
                                        }
                                    }); //END SubDevice Object


                                    //START Add serviceList for SubDevice
                                    i_services = 0;

                                    if (result.root.device.deviceList.device && result.root.device.deviceList.device[i].serviceList.service) {
                                        i_services = result.root.device.deviceList.device[i].serviceList.service.length;

                                        //Counting services
                                        adapter.log.debug("Number of services: " + result.root.device.deviceList.device[i].serviceList.service.length);

                                        if (i_services) {
                                            adapter.log.debug("Found more than one service");
                                            var i2;
                                            var i_unknown = 0;

                                            for (i2 = i_services - 1; i2 >= 0; i2--) {

                                                try {
                                                    xmlService = result.root.device.deviceList.device[i].serviceList.service[i2].serviceType;
                                                } catch(err){
                                                    adapter.log.debug("Can not read service of " + xmlfriendlyName);
                                                    xmlService = "Unknown";
                                                }

                                                try {
                                                    xmlServiceType = result.root.device.deviceList.device[i].serviceList.service[i2].serviceType;
                                                } catch(err){
                                                    adapter.log.debug("Can not read serviceType of " + xmlService);
                                                    xmlServiceType = "";
                                                }

                                                try {
                                                    xmlServiceID = result.root.device.deviceList.device[i].serviceList.service[i2].serviceId;
                                                } catch(err){
                                                    adapter.log.debug("Can not read serviceID of " + xmlService);
                                                    xmlServiceID = "";
                                                }

                                                try {
                                                    xmlControlURL = result.root.device.deviceList.device[i].serviceList.service[i2].controlURL;
                                                } catch(err){
                                                    adapter.log.debug("Can not read controlURL of " + xmlService);
                                                    xmlControlURL = "";
                                                }

                                                try {
                                                    xmlEventSubURL = result.root.device.deviceList.device[i].serviceList.service[i2].eventSubURL;
                                                } catch(err){
                                                    adapter.log.debug("Can not read eventSubURL of " + xmlService);
                                                    xmlEventSubURL = "";
                                                }

                                                try {
                                                    xmlSCPDURL = result.root.device.deviceList.device[i].serviceList.service[i2].SCPDURL;
                                                } catch(err){
                                                    adapter.log.debug("Can not read SCPDURL of " + xmlService);
                                                    xmlSCPDURL = "";
                                                }

                                                if(xmlService == "Unknown"){
                                                    i_unknown = i_unknown + 1;
                                                    xmlService = xmlService + " " + i_unknown;
                                                } else {
                                                    xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                                    xmlService = xmlService.replace(/:\d/g, "");
                                                    xmlService = xmlService.replace(/\"/g, "");
                                                }


                                                adapter.log.debug(i + " " + xmlService + " " + xmlControlURL);

                                                adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService, {
                                                    type: 'channel',
                                                    common: {
                                                        name: xmlService
                                                    },
                                                    native: {
                                                        serviceType: xmlServiceType,
                                                        serviceID:   xmlServiceID,
                                                        controlURL:  xmlControlURL,
                                                        eventSubURL: xmlEventSubURL,
                                                        SCPDURL:     xmlSCPDURL
                                                    }
                                                });
                                                //Dummy State
                                                adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService + '.dummyState', {
                                                    type: 'state',
                                                    common: {
                                                        name: 'Dummy State',
                                                        type: 'boolean',
                                                        role: 'indicator.test',
                                                        write: false,
                                                        read: true
                                                    },
                                                    native: {}
                                                });
                                            }
                                        }
                                        else if (result.root.device.deviceList.device.serviceList.service) {
                                            adapter.log.debug("Found only one service");
                                            try {
                                                xmlService = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceType);
                                                xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                                xmlService = xmlService.replace(/:\d/g, "");
                                                xmlService = xmlService.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read service of " + xmlfriendlyName);
                                                xmlService = "Unknown";
                                            }
                                            adapter.log.debug("Service Name: " + xmlService);

                                            try {
                                                xmlServiceType = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceType);
                                                xmlServiceType = xmlServiceType.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read serviceType of " + xmlService);
                                                xmlServiceType = "";
                                            }

                                            try {
                                                xmlServiceID = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceId);
                                                xmlServiceID = xmlServiceID.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read serviceID of " + xmlService);
                                                xmlServiceID = "";
                                            }

                                            try {
                                                xmlControlURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.controlURL);
                                                xmlControlURL = xmlControlURL.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read controlURL of " + xmlService);
                                                xmlControlURL = "";
                                            }

                                            try {
                                                xmlEventSubURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.eventSubURL);
                                                xmlEventSubURL = xmlEventSubURL.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read eventSubURL of " + xmlService);
                                                xmlEventSubURL = "";
                                            }

                                            try {
                                                xmlSCPDURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.SCPDURL);
                                                xmlSCPDURL = xmlSCPDURL.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read SCPDURL of " + xmlService);
                                                xmlSCPDURL = "";
                                            }

                                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' +  xmlService, {
                                                type: 'channel',
                                                common: {
                                                    name: xmlService

                                                },
                                                native: {
                                                    serviceType: xmlServiceType,
                                                    serviceID:   xmlServiceID,
                                                    controlURL:  xmlControlURL,
                                                    eventSubURL: xmlEventSubURL,
                                                    SCPDURL:     xmlSCPDURL
                                                }
                                            });
                                            //Dummy State
                                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService + '.dummyState', {
                                                type: 'state',
                                                common: {
                                                    name: 'Dummy State',
                                                    type: 'boolean',
                                                    role: 'indicator.test',
                                                    write: false,
                                                    read: true
                                                },
                                                native: {}
                                            });
                                        }



                                    }//END if
                                    //END Add serviceList for SubDevice
                                } //END for
                            }//END if
                            else if (result.root.device.deviceList.device) {
                                //Looking for the freiendlyName of the SubDevice
                                try {
                                    xmlfriendlyName = JSON.stringify(result.root.device.deviceList.device.friendlyName);
                                    xmlfriendlyName = xmlfriendlyName.replace(/\./g, "_");
                                    xmlfriendlyName = xmlfriendlyName.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read friendlyName of SubDevice from " + xmlFN);
                                    xmlfriendlyName = "Unknown;"
                                }

                                //Looking for the manufacturer of a device
                                try {
                                    xmlManufacturer = JSON.stringify(result.root.device.deviceList.device.manufacturer);
                                    xmlManufacturer = xmlManufacturer.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read manufacturer of " + xmlfriendlyName);
                                    xmlManufacturer = "";
                                }

                                //Looking for the manufacturerURL
                                try {
                                    xmlManufacturerURL = JSON.stringify(result.root.device.deviceList.device.manufacturerURL);
                                    xmlManufacturerURL = xmlManufacturerURL.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read manufacturerURL of " + xmlfriendlyName);
                                    xmlManufacturerURL = "";
                                }

                                //Looking for the modelNumber
                                try {
                                    xmlModelNumber = JSON.stringify(result.root.device.deviceList.device.modelNumber);
                                    xmlModelNumber = xmlModelNumber.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read modelNumber of " + xmlfriendlyName);
                                    xmlModelNumber = "";
                                }

                                //Looking for the modelDescription
                                try {
                                    xmlModelDescription = JSON.stringify(result.root.device.deviceList.device.modelDescription);
                                    xmlModelDescription = xmlModelDescription.replace(/\"/g, "");
                                }catch(err){
                                    adapter.log.debug("Can not read modelDescription of " + xmlfriendlyName);
                                    xmlModelDescription = "";
                                }

                                //Looking for the DeviceType
                                try {
                                    xmlDeviceType = JSON.stringify(result.root.device.deviceList.device.deviceType);
                                    xmlDeviceType = xmlDeviceType.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read deviceType of " + xmlfriendlyName);
                                }

                                //Looking for the modelName
                                try {
                                    xmlModelName = JSON.stringify(result.root.device.deviceList.device.modelName);
                                    xmlModelName = xmlModelName.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read modelName of " + xmlfriendlyName);
                                    xmlModelName = "";
                                }

                                //Looking for the modelURL
                                try {
                                    xmlModelURL = JSON.stringify(result.root.device.deviceList.device.modelURL);
                                    xmlModelURL = xmlModelURL.replace(/\"/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read modelURL of " + xmlfriendlyName);
                                    xmlModelURL = "";
                                }

                                //Looking for UDN of a device
                                try {
                                    xmlUDN = JSON.stringify(result.root.device.deviceList.device.UDN);
                                    xmlUDN = xmlUDN.replace(/\"/g, "");
                                    xmlUDN = xmlUDN.replace(/uuid\:/g, "");
                                } catch(err){
                                    adapter.log.debug("Can not read UDN of " + xmlfriendlyName);
                                    xmlUDN = "";
                                }

                                //START The SubDevice object
                                adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName, {
                                    type: 'device',
                                    common: {
                                        name: xmlfriendlyName
                                    },
                                    native: {
                                        uuid: xmlUDN,
                                        deviceType: xmlDeviceType,
                                        manufacturer: xmlManufacturer,
                                        manufacturerURL: 	xmlManufacturerURL,
                                        modelNumber: xmlModelNumber,
                                        modelDescription: xmlModelDescription,
                                        modelName: xmlModelName,
                                        modelURL: xmlModelURL
                                    }
                                });
                                //END The SubDevice object

                                //START Add serviceList for SubDevice
                                i_services = 0;

                                if (result.root.device.deviceList && result.root.device.deviceList.device[i].serviceList.service) {
                                    i_services = result.root.device.deviceList.device[i].serviceList.service.length;

                                    //Counting services
                                    adapter.log.debug("Number of services: " + result.root.device.deviceList.device[i].serviceList.service.length);

                                    if (i_services) {
                                        adapter.log.debug("Found more than one service");
                                        var i3;
                                        for (i3 = i_services - 1; i3 >= 0; i3--) {

                                            try {
                                                xmlService = result.root.device.deviceList.device[i].serviceList.service[i3].serviceType;
                                                xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                                xmlService = xmlService.replace(/:\d/g, "");
                                                xmlService = xmlService.replace(/\"/g, "");
                                            } catch(err){
                                                adapter.log.debug("Can not read service of " + xmlfriendlyName);
                                                xmlService = "Unknown";
                                            }

                                            try {
                                                xmlServiceType = result.root.device.deviceList.device[i].serviceList.service[i3].serviceType;
                                            } catch(err){
                                                adapter.log.debug("Can not read serviceType of " + xmlService);
                                                xmlServiceType = "";
                                            }

                                            try {
                                                xmlServiceID = result.root.device.deviceList.device[i].serviceList.service[i3].serviceId;
                                            } catch(err){
                                                adapter.log.debug("Can not read serviceID of " + xmlService);
                                                xmlServiceID = "";
                                            }

                                            try {
                                                xmlControlURL = result.root.device.deviceList.device[i].serviceList.service[i3].controlURL;
                                            } catch(err){
                                                adapter.log.debug("Can not read controlURL of " + xmlService);
                                                xmlControlURL = "";
                                            }

                                            try {
                                                xmlEventSubURL = result.root.device.deviceList.device[i].serviceList.service[i3].eventSubURL;
                                            } catch(err){
                                                adapter.log.debug("Can not read eventSubURL of " + xmlService);
                                                xmlEventSubURL = "";
                                            }

                                            try {
                                                xmlSCPDURL = result.root.device.deviceList.device[i].serviceList.service[i3].SCPDURL;
                                            } catch(err){
                                                adapter.log.debug("Can not read SCPDURL of " + xmlService);
                                                xmlSCPDURL = "";
                                            }


                                            adapter.log.debug(i + " " + xmlService + " " + xmlControlURL);

                                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService, {
                                                type: 'channel',
                                                common: {
                                                    name: xmlService
                                                },
                                                native: {
                                                    serviceType: xmlServiceType,
                                                    serviceID:   xmlServiceID,
                                                    controlURL:  xmlControlURL,
                                                    eventSubURL: xmlEventSubURL,
                                                    SCPDURL:     xmlSCPDURL
                                                }
                                            });
                                            //Dummy State
                                            adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService + '.dummyState', {
                                                type: 'state',
                                                common: {
                                                    name: 'Dummy State',
                                                    type: 'boolean',
                                                    role: 'indicator.test',
                                                    write: false,
                                                    read: true
                                                },
                                                native: {}
                                            });
                                        }
                                    }
                                    else if (result.root.device.deviceList.device.serviceList.service) {
                                        adapter.log.debug("Found only one service");

                                        try {
                                            xmlService = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceType);
                                            xmlService = xmlService.replace(/urn:.*:service:/g, "");
                                            xmlService = xmlService.replace(/:\d/g, "");
                                            xmlService = xmlService.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read service of " + xmlfriendlyName);
                                            xmlService = "Unknown";
                                        }
                                        adapter.log.debug("Service Name: " + xmlService);

                                        try {
                                            xmlServiceType = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceType);
                                            xmlServiceType = xmlServiceType.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read serviceType of " + xmlService);
                                            xmlServiceType = "";
                                        }

                                        try {
                                            xmlServiceID = JSON.stringify(result.root.device.deviceList.device.serviceList.service.serviceId);
                                            xmlServiceID = xmlServiceID.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read serviceID of " + xmlService);
                                            xmlServiceID = "";
                                        }

                                        try {
                                            xmlControlURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.controlURL);
                                            xmlControlURL = xmlControlURL.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read controlURL of " + xmlService);
                                            xmlControlURL = "";
                                        }

                                        try {
                                            xmlEventSubURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.eventSubURL);
                                            xmlEventSubURL = xmlEventSubURL.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read eventSubURL of " + xmlService);
                                            xmlEventSubURL = "";
                                        }

                                        try {
                                            xmlSCPDURL = JSON.stringify(result.root.device.deviceList.device.serviceList.service.SCPDURL);
                                            xmlSCPDURL = xmlSCPDURL.replace(/\"/g, "");
                                        } catch(err){
                                            adapter.log.debug("Can not read SCPDURL of " + xmlService);
                                            xmlSCPDURL = "";
                                        }

                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' +  xmlService, {
                                            type: 'channel',
                                            common: {
                                                name: xmlService

                                            },
                                            native: {
                                                serviceType: xmlServiceType,
                                                serviceID:   xmlServiceID,
                                                controlURL:  xmlControlURL,
                                                eventSubURL: xmlEventSubURL,
                                                SCPDURL:     xmlSCPDURL
                                            }
                                        });
                                        //Dummy State
                                        adapter.setObject(xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' + xmlService + '.dummyState', {
                                            type: 'state',
                                            common: {
                                                name: 'Dummy State',
                                                type: 'boolean',
                                                role: 'indicator.test',
                                                write: false,
                                                read: true
                                            },
                                            native: {}
                                        });
                                    }

                                    //Read the SCPD file
                                    var service = xmlFN + '.' + xmlTypeOfDevice + '.' + xmlfriendlyName + '.' +  xmlService;
                                    readSCPD(SCPDlocation, service);

                                }//END if
                                //END Add serviceList for SubDevice

                            }	//END if
                        } //END if
                        //END - Creating SubDevices list for a device



                    });

            } catch (error) {
                adapter.log.error('Cannot parse answer from ' + strLocation + ': ' + error);
            }
         }
    });
    return true;
}
//END Reading the xml device description file of each upnp device the first time

//START Read the SCPD File  of a upnp device service
function readSCPD(SCPDlocation, service){


    adapter.log.debug("readSCPD for " + SCPDlocation);

    request(SCPDlocation, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            adapter.log.debug("Positive answer for request of the XML file for " + SCPDlocation);

            try {
                parseString(body, {
                        explicitArray: false,
                        mergeAttrs: true
                    },
                    function (err, result) {
                        adapter.log.debug("Parsing the SCPD XML file for " + SCPDlocation);

                        if (err) {
                            adapter.log.warn("Error: " + err);
                        } else {
                            adapter.log.debug("Creating objects for " + SCPDlocation);

                            if (!result || !result.scpd) {
                                adapter.log.warn('Error by parsing of ' + SCPDlocation);
                                return;
                            } //END if

                            createServiceStateTable(result, service);
                            createActionList(result, service);

                        } //END if
                    } //END function
                ); //END parseString
            } catch (error) {
                adapter.log.error('Cannot parse answer from ' + SCPDlocation + ': ' + error);
            }
        }
        })
}
//END Read the SCPD File  of a upnp device service

//START Creating serviceStateTable
function createServiceStateTable(result, service){
    var i_stateVariable = 0;
    var StateVariablePath;
    var stateVariableAttr;
    var xmlName;
    var xmlDataType;


    if (result.scpd.serviceStateTable && result.scpd.serviceStateTable.stateVariable) {
         i_stateVariable = result.scpd.serviceStateTable.stateVariable.length;

        //Counting stateVariable's
        adapter.log.debug("Number of stateVariables: " + result.scpd.serviceStateTable.stateVariable.length);

        if (i_stateVariable) {
            adapter.log.debug("Found more than one stateVariable");
            var i2;
            for (i2 = i_stateVariable - 1; i2 >= 0; i2--) {
                StateVariablePath = "serviceStateTable";

                stateVariableAttr = result.scpd[StateVariablePath].stateVariable[i2].sendEvents;
                xmlName = result.scpd.serviceStateTable.stateVariable[i2].name;
                xmlDataType = result.scpd.serviceStateTable.stateVariable[i2].dataType;


                //adapter.log.debug(i2 + " " + stateVariableAttr + " " + xmlName + " " + xmlDataType);

                adapter.setObject(service + '.' + xmlName, {
                    type: 'state',
                    common: {
                        name: xmlName,
                        type: xmlDataType,
                        role: "indicator.state"
                    },
                    native: {sendEvents: stateVariableAttr
                    }
                });

            }
        }
        else if (result.scpd.serviceStateTable.stateVariable) {
            adapter.log.debug("Found only one stateVariable");


            stateVariableAttr = JSON.stringify(result.scpd.serviceStateTable.stateVariable.sendEvents);
            xmlName = JSON.stringify(result.scpd.serviceStateTable.stateVariable.name);
            xmlDataType = JSON.stringify(result.scpd.serviceStateTable.stateVariable.dataType);

            adapter.setObject(service + '.' + xmlName, {
                type: 'state',
                common: {
                    name: xmlName,
                    type: xmlDataType,
                    role: "indicator.state"
                },
                native: {sendEvents: stateVariableAttr
                }
            });

        }

    }//END if
    //END Add serviceList for SubDevice

} //END function
//END Creating serviceStateTable



//START Creating actionList
function createActionList(result, service){
    var i_action = 0;
    var actionListPath;
    var xmlName;

    if (result.scpd.actionList && result.scpd.actionList.action) {
        i_action = result.scpd.actionList.action.length;

        //Counting action's
        adapter.log.debug("Number of actions: " + result.scpd.actionList.action.length);

        if (i_action) {
            adapter.log.debug("Found more than one action");
            var i2;
            for (i2 = i_action - 1; i2 >= 0; i2--) {
                actionListPath = "actionList"; //Diese Variable soll später beim aufruf der Funktion übergeben werden

                xmlName = result.scpd.actionList.action[i2].name;
                xmlName = xmlName.replace(/\"/g, "");

                adapter.setObject(service + '.' + xmlName, {
                    type: 'channel',
                    common: {
                        name: xmlName,
                        role: 'action'
                    },
                    native: {}
                });

                //Dummy State
                adapter.setObject(service + '.' +xmlName + '.dummyState', {
                    type: 'state',
                    common: {
                        name: 'Dummy State',
                        type: 'boolean',
                        role: 'indicator.test',
                        write: false,
                        read: true
                    },
                    native: {}
                });
                try {
                    createArgumentList(result, service, xmlName, i2);
                } catch(err){
                    adapter.log.debug("There is no argument for " + xmlName);
                }
            }
        }
        else if (result.scpd.actionList.action) {
            adapter.log.debug("Found only one action");

            xmlName = JSON.stringify(result.scpd.actionList.action.name);
            xmlName = xmlName.replace(/\"/g, "");

            adapter.setObject(service + '.' + xmlName, {
                type: 'channel',
                common: {
                    name: xmlName,
                    role: 'action'
                },
                native: {}
            });

            //Dummy State
            adapter.setObject(service + '.' + xmlName + '.dummyState', {
                type: 'state',
                common: {
                    name: 'Dummy State',
                    type: 'boolean',
                    role: 'indicator.test',
                    write: false,
                    read: true
                },
                native: {}
            });
            try {
                createArgumentList(result, service, xmlName, "");
            } catch(err){
                adapter.log.debug("There is no argument for " + xmlName);
            }
        }

    }//END if
    //END Add serviceList for SubDevice

} //END function
//END Creating actionList



//START Creating argumentList
function createArgumentList(result, service, actionName, action_number){
    var i_argument = 0;
    var xmlName;
    var xmlDirection;
    var xmlrelStateVar;

    adapter.log.debug("Reading argumentList for " + actionName);

    if (result.scpd.actionList && result.scpd.actionList.action) {
        i_argument = result.scpd.actionList.action[action_number].argumentList.argument.length;

        //Counting arguments's
        adapter.log.debug("Number of argument's: " + result.scpd.actionList.action[action_number].argumentList.argument.length);

        if (i_argument) {
            adapter.log.debug("Found more than one argument");
            var i2;
            for (i2 = i_argument - 1; i2 >= 0; i2--) {

                try {
                xmlName = result.scpd.actionList.action[action_number].argumentList.argument[i2].name;
                    xmlName = xmlName.replace(/\"/g, "");
                } catch(err){
                    adapter.log.debug("Can not read argument Name of " + actionName);
                    xmlName = "Unknown";
                }

                try {
                    xmlDirection = result.scpd.actionList.action[action_number].argumentList.argument[i2].direction;
                } catch(err) {
                    adapter.log.debug("Can not read direction of " + actionName);
                    xmlDirection = "";
                }

                try {
                    xmlrelStateVar = result.scpd.actionList.action[action_number].argumentList.argument[i2].relatedStateVariable;
                } catch(err) {
                    adapter.log.debug("Can not read relatedStateVariable of " + actionName);
                    xmlrelStateVar = "";
                }

                adapter.setObject(service + '.' + actionName + '.' + xmlName, {
                    type: 'state',
                    common: {
                        name: xmlName,
                        role: 'argument',
                        type: 'mixed'
                    },
                    native: {direction: xmlDirection,
                            relatedStateVariable: xmlrelStateVar}
                });

                //Dummy State
                adapter.setObject(service + '.' + actionName + '.' + xmlName + '.dummyState', {
                    type: 'state',
                    common: {
                        name: 'Dummy State',
                        type: 'boolean',
                        role: 'indicator.test',
                        write: false,
                        read: true
                    },
                    native: {}
                });
            }
        }
        else if (result.scpd.actionList.action[action_number].argumentList.argument) {
            adapter.log.debug("Found only one argument");

            xmlName = JSON.stringify(result.scpd.actionList.action[action_number].argumentList.argument.name);
            xmlName = xmlName.replace(/\"/g, "");

            adapter.setObject(service + '.' + actionName + '.' + xmlName, {
                type: 'state',
                common: {
                    name: xmlName,
                    role: 'argument',
                    type: 'mixed'
                },
                native: {direction: xmlDirection,
                    relatedStateVariable: xmlrelStateVar}
            });

            //Dummy State
            adapter.setObject(service + '.' + actionName + '.' + xmlName + '.dummyState', {
                type: 'state',
                common: {
                    name: 'Dummy State',
                    type: 'boolean',
                    role: 'indicator.test',
                    write: false,
                    read: true
                },
                native: {}
            });
        }

    }//END if
    //END Add argumentList for action

} //END function
//END Creating argumentList
